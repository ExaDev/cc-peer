/**
 * Entry point for one reply alias's real OS process, forked by ForkedAliasProcess. Excluded from the coverage gate the same way src/bin/** is (see vitest.config.ts): pure process-lifecycle glue, exercised end to end by a real fork in forked-alias-process.integration.test.ts rather than in-process unit coverage.
 */
import process from "node:process";

import { CcPeer, type InboundMessage } from "../../cc-peer.js";
import { CcPeerError } from "../../errors.js";
import {
  AliasCommandSchema,
  type AliasSendCommand,
} from "../../schemas/alias-ipc.js";

let peer: CcPeer | undefined;

process.on("message", (raw: unknown) => {
  void handleCommand(raw);
});

// The parent's IPC channel is this process's only lifeline: when the process that forked it dies without stopping it (a crash or a kill, where no stop command is ever sent) the channel closes and nothing else would ever end this worker. Left running it would stay registered under its correspondent's name, so a session replying to that name could reach this orphan instead of the live alias, and the orphan can no longer relay anything.
process.on("disconnect", () => {
  void shutdown();
});

async function shutdown(): Promise<void> {
  await peer?.stop();
  process.exit(0);
}

/** Relays an event to the parent unless its channel has already closed, since a send on a closed channel raises an error event on the process that nothing handles. */
function relay(message: Readonly<Record<string, unknown>>): void {
  if (process.connected) process.send?.(message);
}

async function handleCommand(raw: unknown): Promise<void> {
  if (!AliasCommandSchema.is(raw)) return;
  if (raw.type === "stop") {
    await shutdown();
    return;
  }
  if (raw.type === "send") {
    await handleSend(raw);
    return;
  }
  let created: CcPeer;
  try {
    created = await CcPeer.create({
      name: raw.name,
      ...(raw.homeDir !== undefined ? { homeDir: raw.homeDir } : {}),
      ...(raw.socketDir !== undefined ? { socketDir: raw.socketDir } : {}),
      ...(raw.sessionId !== undefined ? { sessionId: raw.sessionId } : {}),
    });
  } catch {
    process.exit(1);
    return;
  }
  peer = created;
  peer.on("message", (message: InboundMessage) => {
    relay({ type: "message", ...message });
  });
  relay({ type: "started" });
}

async function handleSend(command: Readonly<AliasSendCommand>): Promise<void> {
  const active = peer;
  if (active === undefined) {
    relay({
      type: "send_failed",
      requestId: command.requestId,
      code: "NOT_STARTED",
      message: "alias peer has not started",
    });
    return;
  }
  try {
    const { msgId } = await active.send(command.target, command.body);
    relay({ type: "sent", requestId: command.requestId, msgId });
  } catch (error) {
    relay({
      type: "send_failed",
      requestId: command.requestId,
      code: error instanceof CcPeerError ? error.code : "UNKNOWN",
      message:
        error instanceof Error ? error.message : "unknown alias send failure",
    });
  }
}
