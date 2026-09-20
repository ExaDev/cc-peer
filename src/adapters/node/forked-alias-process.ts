import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";

import type {
  AliasProcess,
  AliasStartOptions,
} from "../../ports/alias-process.js";
import {
  AliasMessageEventSchema,
  AliasSendFailedEventSchema,
  AliasSentEventSchema,
  AliasStartedEventSchema,
  type AliasMessageEvent,
} from "../../schemas/alias-ipc.js";
import { AliasSendError, AliasStartError } from "../../errors.js";
import { newMsgId } from "../../domain/ids.js";
import type { InboundMessage, PeerRef } from "../../cc-peer.js";

/** One in-flight send command, settled when its own acknowledgement arrives or the worker exits. */
interface PendingSend {
  resolve: (result: Readonly<{ msgId: string }>) => void;
  reject: (error: Error) => void;
}

export interface ForkedAliasProcessDeps {
  /**
   * The alias-worker.ts entry's own built location. Deliberately required rather than computed from this module's own `import.meta.url`: tsdown folds this file's compiled code into a shared chunk alongside the other entries, so a sibling-relative URL computed here would resolve against that chunk's own (bundler-chosen, unstable) location rather than the source tree's real layout. alias-pool.ts computes the real path instead, from its own `import.meta.url` — a genuine dedicated entry, guaranteed to sit next to alias-worker.ts's own build output at a predictable relative path (see tsdown.config.ts).
   */
  workerPath: string;
  fork?: typeof fork;
}

/**
 * The real, Node-backed {@link AliasProcess}: forks a fresh OS process running `alias-worker.ts`, which registers a standalone CcPeer under the given name and relays every inbound reply back over the fork's own IPC channel.
 */
export class ForkedAliasProcess implements AliasProcess {
  readonly events = new EventEmitter();
  private readonly forkFn: typeof fork;
  private readonly workerPath: string;
  private readonly pendingSends = new Map<string, PendingSend>();
  private child: ChildProcess | undefined;

  constructor(deps: Readonly<ForkedAliasProcessDeps>) {
    this.forkFn = deps.fork ?? fork;
    this.workerPath = deps.workerPath;
  }

  async start(options: Readonly<AliasStartOptions>): Promise<void> {
    const child = this.forkFn(this.workerPath, [], {});
    this.child = child;
    child.on("message", (raw: unknown) => {
      if (AliasMessageEventSchema.is(raw)) {
        this.events.emit("message", toInboundMessage(raw));
        return;
      }
      this.settleSend(raw);
    });
    child.on("exit", () => {
      this.failPendingSends(
        "alias worker exited before the send was acknowledged",
      );
      this.events.emit("exit");
    });
    await new Promise<void>((resolve, reject) => {
      function onExitBeforeStart(code: number | null): void {
        child.off("message", onStarted);
        reject(
          new AliasStartError(
            `alias worker exited before starting (code ${code === null ? "null" : code.toString()})`,
          ),
        );
      }
      function onStarted(raw: unknown): void {
        if (AliasStartedEventSchema.is(raw)) {
          child.off("message", onStarted);
          child.off("exit", onExitBeforeStart);
          resolve();
        }
      }
      child.on("message", onStarted);
      child.once("exit", onExitBeforeStart);
      child.send({
        type: "start",
        name: options.name,
        ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
        ...(options.socketDir !== undefined
          ? { socketDir: options.socketDir }
          : {}),
        ...(options.sessionId !== undefined
          ? { sessionId: options.sessionId }
          : {}),
      });
    });
  }

  async send(
    target: Readonly<PeerRef>,
    body: string,
  ): Promise<{ msgId: string }> {
    const child = this.runningChild();
    if (child === undefined) {
      throw new AliasSendError("alias worker is not running");
    }
    const requestId = newMsgId();
    return new Promise<{ msgId: string }>((resolve, reject) => {
      this.pendingSends.set(requestId, { resolve, reject });
      child.send({ type: "send", requestId, target, body });
    });
  }

  /** Settles the one in-flight send an acknowledgement names. An acknowledgement for an unknown request is ignored: the send it belongs to was already settled by the worker exiting. */
  private settleSend(raw: unknown): void {
    if (AliasSentEventSchema.is(raw)) {
      this.takePendingSend(raw.requestId)?.resolve({ msgId: raw.msgId });
      return;
    }
    if (AliasSendFailedEventSchema.is(raw)) {
      this.takePendingSend(raw.requestId)?.reject(
        new AliasSendError(`${raw.code}: ${raw.message}`),
      );
    }
  }

  private takePendingSend(requestId: string): PendingSend | undefined {
    const pending = this.pendingSends.get(requestId);
    this.pendingSends.delete(requestId);
    return pending;
  }

  private failPendingSends(reason: string): void {
    const pending = [...this.pendingSends.values()];
    this.pendingSends.clear();
    for (const send of pending) {
      send.reject(new AliasSendError(reason));
    }
  }

  /** The forked child while it is still running, or undefined before start() and once it has ended: a command written past that point reaches a channel nothing is reading. */
  private runningChild(): ChildProcess | undefined {
    const child = this.child;
    if (child === undefined) return undefined;
    if (child.exitCode !== null || child.signalCode !== null) return undefined;
    return child;
  }

  async stop(): Promise<void> {
    const child = this.runningChild();
    if (child === undefined) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
      child.send({ type: "stop" });
    });
  }
}

function toInboundMessage(event: Readonly<AliasMessageEvent>): InboundMessage {
  return {
    ...(event.from !== undefined ? { from: event.from } : {}),
    ...(event.fromSession !== undefined
      ? { fromSession: event.fromSession }
      : {}),
    ...(event.fromName !== undefined ? { fromName: event.fromName } : {}),
    ...(event.fromMode !== undefined ? { fromMode: event.fromMode } : {}),
    ...(event.hopChain !== undefined ? { hopChain: event.hopChain } : {}),
    body: event.body,
    msgId: event.msgId,
  };
}
