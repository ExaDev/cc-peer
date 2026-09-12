import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";

import { UdsTransport, SystemClock } from "./adapters/node/uds-transport.js";
import { FsKeyStore } from "./adapters/node/fs-key-store.js";
import { FsRegistryStore } from "./adapters/node/fs-registry-store.js";
import { PsProcInfo } from "./adapters/node/ps-proc-info.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { socketPathForPid, type PathConfig } from "./adapters/node/paths.js";
import { buildEnvelope, parseEnvelope } from "./domain/envelope.js";
import { Pacer } from "./domain/pacer.js";
import { newMsgId } from "./domain/ids.js";
import { filterRoster } from "./domain/roster.js";
import type { Transport, ListeningSocket } from "./ports/transport.js";
import type { RegistryStore } from "./ports/registry-store.js";
import type { KeyStore } from "./ports/key-store.js";
import type { ProcInfo } from "./ports/proc-info.js";
import type { Clock } from "./ports/clock.js";
import type { RegistryEntry } from "./schemas/registry.js";
import {
  AuthLineSchema,
  PeerIdleNoticeSchema,
  PeerMessageStatusSchema,
  UserFrameSchema,
  WireFrameSchema,
  type PeerIdleNotice,
  type PeerMessageStatus,
  type UserFrame,
} from "./schemas/wire.js";
import type { PeerKeyFile } from "./schemas/keyfile.js";
import {
  MessageTooLargeError,
  NoLiveInboxError,
  NotStartedError,
  UnknownPeerError,
} from "./errors.js";

/** Package version placeholder until semantic-release owns it. */
export const CC_PEER_VERSION = "0.0.0";

/** Default log sink: logs go nowhere unless a logger is provided. */
const sinkLog = (): void => undefined;

/** How a target can be addressed. */
export type PeerRef = { pid: number } | { name: string } | { address: string };

export interface CcPeerOptions extends PathConfig {
  name?: string;
  sessionId?: string;
  heartbeatMs?: number;
  logger?: (message: string) => void;
}

export interface SendOptions {
  priority?: "next" | "later";
  /** Attaches from-mode attestation; false deliberately sends unattested (recipient holds it). */
  fromMode?: "bypass" | "prompting" | false;
  /** When set, must match the receiver's sessionId or the frame is silently dropped. */
  sessionId?: string;
}

export interface InboundMessage {
  from?: string;
  fromSession?: string;
  fromName?: string;
  fromMode?: "bypass" | "prompting";
  hopChain?: string[];
  body: string;
  msgId: string;
}

export type Receipt = PeerMessageStatus;
export type IdleNotice = PeerIdleNotice;

interface Deps {
  transport: Transport;
  registry: RegistryStore;
  keys: KeyStore;
  procInfo: ProcInfo;
  clock: Clock;
}

/** Peer tokens are 16 random bytes in hex, matching the reference key files. */
const PEER_TOKEN_BYTES = 16;
/** Byte cap on the serialized frame line, mirroring the receiver's line guard. */
const MAX_FRAME_CHARS = 120_000;
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * A registered peer on Claude Code's cross-session mesh. Receipts and idle notices only reach the process that owns the listening socket (the protocol verifies return addresses via kernel peer pids), so do not split sending and listening across differently-owned processes.
 */
export class CcPeer extends EventEmitter {
  private listening: ListeningSocket | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private ownKey: PeerKeyFile | undefined;
  private readonly pacer: Pacer;
  private readonly log: (message: string) => void;
  private stopped = false;

  constructor(
    private readonly options: Readonly<CcPeerOptions>,
    private readonly deps: Deps,
  ) {
    super();
    this.pacer = new Pacer(deps.clock);
    this.log = options.logger ?? sinkLog;
  }

  static async create(options: Readonly<CcPeerOptions> = {}): Promise<CcPeer> {
    const peer = new CcPeer(options, {
      transport: new UdsTransport(),
      registry: new FsRegistryStore(options),
      keys: new FsKeyStore(options),
      procInfo: new PsProcInfo(),
      clock: new SystemClock(),
    });
    await peer.start();
    return peer;
  }

  private async start(): Promise<void> {
    const socketPath = socketPathForPid(process.pid, this.options);
    this.ownKey = {
      peerToken: randomBytes(PEER_TOKEN_BYTES).toString("hex"),
      procStart: (await this.deps.procInfo.lstart(process.pid)) ?? "",
      pidDomain: "darwin",
    };
    if (this.ownKey.procStart === "") {
      throw new NotStartedError("could not read own procStart via ps");
    }
    await this.deps.keys.writeForSocket(socketPath, this.ownKey);
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    const entry = this.buildRegistryEntry();
    await this.deps.registry.write(entry);
    this.listening = await this.deps.transport.listen(socketPath, (conn) => {
      void this.handleConnection(conn);
    });
    this.heartbeatTimer = setInterval(() => {
      void this.deps.registry.touch(process.pid).catch(() => undefined);
    }, this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    this.heartbeatTimer.unref();
    this.log(`listening as ${this.options.name ?? "unnamed"} at ${socketPath}`);
  }

  private buildRegistryEntry(): RegistryEntry {
    const now = this.deps.clock.nowMs();
    return {
      pid: process.pid,
      sessionId: this.options.sessionId ?? newMsgId(),
      cwd: process.cwd(),
      startedAt: now,
      procStart: this.ownKey?.procStart ?? "",
      version: "cc-peer",
      peerProtocol: 1,
      peerFeatures: ["notify_idle", "reply_across_default_dirs"],
      kind: "interactive",
      entrypoint: "cli",
      pidDomain: "darwin",
      messagingSocketPath: socketPathForPid(process.pid, this.options),
      ...(this.options.name !== undefined
        ? {
            name: this.options.name,
            nameSource: "user" as const,
            nameSince: now,
          }
        : {}),
      updatedAt: now,
      status: "idle",
      statusUpdatedAt: now,
    };
  }

  async roster(): Promise<RegistryEntry[]> {
    const entries = await this.deps.registry.list();
    return filterRoster(entries, {
      transport: this.deps.transport,
      procInfo: this.deps.procInfo,
      ...(this.listening !== undefined
        ? { ownSocketPath: this.listening.socketPath }
        : {}),
    });
  }

  async send(
    target: PeerRef,
    body: string,
    options: Readonly<SendOptions> = {},
  ): Promise<{ msgId: string }> {
    if (
      this.stopped ||
      this.listening === undefined ||
      this.ownKey === undefined
    ) {
      throw new NotStartedError("peer is not running");
    }
    const socketPath = await this.resolveTarget(target);
    const key = await this.deps.keys.readForSocket(socketPath);
    const msgId = newMsgId();
    const from = `uds:${this.listening.socketPath}`;
    const envelope = buildEnvelope(
      {
        from,
        ...((options.sessionId ?? this.options.sessionId) !== undefined
          ? { fromSession: options.sessionId ?? this.options.sessionId }
          : {}),
        ...(this.options.name !== undefined
          ? { fromName: this.options.name }
          : {}),
        ...(options.fromMode !== false && options.fromMode !== undefined
          ? { fromMode: options.fromMode }
          : {}),
        ...(options.fromMode === undefined
          ? { fromMode: "bypass" as const }
          : {}),
      },
      body,
    );
    const frame: UserFrame = {
      msgV: 1,
      msg_id: msgId,
      type: "user",
      message: { role: "user", content: envelope },
      priority: options.priority ?? "next",
      from,
    };
    if (key === undefined) {
      throw new NoLiveInboxError(`no auth key published for ${socketPath}`);
    }
    const auth = AuthLineSchema.parse({ type: "auth", token: key.peerToken });
    const line = JSON.stringify(frame);
    if (line.length > MAX_FRAME_CHARS) {
      throw new MessageTooLargeError(
        `serialized frame is ${line.length.toString()} chars, cap ${MAX_FRAME_CHARS.toString()}`,
      );
    }
    await this.pacedSend(socketPath, [JSON.stringify(auth), line]);
    return { msgId };
  }

  private async pacedSend(
    socketPath: string,
    lines: readonly string[],
  ): Promise<void> {
    const waitMs = this.pacer.msUntilNextToken();
    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolve();
        }, waitMs);
        timer.unref();
      });
    }
    if (!this.pacer.tryReserve()) {
      await this.pacedSend(socketPath, lines);
      return;
    }
    await this.deps.transport.connectWrite(socketPath, lines);
  }

  async subscribeIdle(target: PeerRef): Promise<{ msgId: string }> {
    if (
      this.stopped ||
      this.listening === undefined ||
      this.ownKey === undefined
    ) {
      throw new NotStartedError("peer is not running");
    }
    const socketPath = await this.resolveTarget(target);
    const key = await this.deps.keys.readForSocket(socketPath);
    if (key === undefined) {
      throw new NoLiveInboxError(`no auth key published for ${socketPath}`);
    }
    const msgId = newMsgId();
    const frame = {
      msgV: 1,
      msg_id: msgId,
      type: "control" as const,
      action: "notify_when_idle" as const,
      from: `uds:${this.listening.socketPath}`,
      from_mode: "bypass" as const,
    };
    const auth = AuthLineSchema.parse({ type: "auth", token: key.peerToken });
    await this.deps.transport.connectWrite(socketPath, [
      JSON.stringify(auth),
      JSON.stringify(frame),
    ]);
    return { msgId };
  }

  private async resolveTarget(target: PeerRef): Promise<string> {
    if ("pid" in target) return socketPathForPid(target.pid, this.options);
    if ("address" in target) {
      return target.address.replace(/^uds:/, "");
    }
    const roster = await this.roster();
    const match = roster.find((entry) => entry.name === target.name);
    if (match === undefined) {
      throw new UnknownPeerError(`no roster entry named ${target.name}`);
    }
    return match.messagingSocketPath;
  }

  private async handleConnection(
    conn: Readonly<{
      readLines: () => AsyncIterable<string>;
    }>,
  ): Promise<void> {
    const lines = conn.readLines();
    const first = await lines[Symbol.asyncIterator]().next();
    if (first.done === true) return;
    // Auth line: verified against our own peerToken when present; absent or foreign tokens fall through to the unauthenticated peer class on macOS.
    if (this.ownKey !== undefined) {
      const parsed: unknown = JSON.parse(first.value);
      if (AuthLineSchema.is(parsed) && parsed.token !== this.ownKey.peerToken) {
        this.log("inbound auth token mismatch (foreign token tolerated)");
      }
    }
    for await (const line of lines) {
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (!WireFrameSchema.safeParse(frame).success) continue;
      if (UserFrameSchema.is(frame)) {
        const envelope = parseEnvelope(frame.message.content);
        this.emit("message", {
          ...(envelope?.from !== undefined ? { from: envelope.from } : {}),
          ...(envelope?.fromSession !== undefined
            ? { fromSession: envelope.fromSession }
            : {}),
          ...(envelope?.fromName !== undefined
            ? { fromName: envelope.fromName }
            : {}),
          ...(envelope?.fromMode !== undefined
            ? { fromMode: envelope.fromMode }
            : {}),
          ...(envelope?.hopChain !== undefined
            ? { hopChain: envelope.hopChain }
            : {}),
          body: envelope?.body ?? frame.message.content,
          msgId: frame.msg_id,
        } satisfies InboundMessage);
      } else if (PeerMessageStatusSchema.is(frame)) {
        this.emit("receipt", frame satisfies Receipt);
      } else if (PeerIdleNoticeSchema.is(frame)) {
        this.emit("idle", frame satisfies IdleNotice);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    if (this.listening !== undefined) {
      const socketPath = this.listening.socketPath;
      await this.listening.close();
      await this.deps.keys.removeForSocket(socketPath);
      await this.deps.registry.remove(process.pid);
    }
  }
}
