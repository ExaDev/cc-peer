import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";

import type {
  AliasProcess,
  AliasStartOptions,
} from "../../ports/alias-process.js";
import {
  AliasMessageEventSchema,
  AliasStartedEventSchema,
  type AliasMessageEvent,
} from "../../schemas/alias-ipc.js";
import { AliasStartError } from "../../errors.js";
import type { InboundMessage } from "../../cc-peer.js";

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
      }
    });
    child.on("exit", () => {
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

  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
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
