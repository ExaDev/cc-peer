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

async function handleCommand(raw: unknown): Promise<void> {
  if (!AliasCommandSchema.is(raw)) return;
  if (raw.type === "stop") {
    await peer?.stop();
    process.exit(0);
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
    process.send?.({ type: "message", ...message });
  });
  process.send?.({ type: "started" });
}

async function handleSend(command: Readonly<AliasSendCommand>): Promise<void> {
  const active = peer;
  if (active === undefined) {
    process.send?.({
      type: "send_failed",
      requestId: command.requestId,
      code: "NOT_STARTED",
      message: "alias peer has not started",
    });
    return;
  }
  try {
    const { msgId } = await active.send(command.target, command.body);
    process.send?.({ type: "sent", requestId: command.requestId, msgId });
  } catch (error) {
    process.send?.({
      type: "send_failed",
      requestId: command.requestId,
      code: error instanceof CcPeerError ? error.code : "UNKNOWN",
      message:
        error instanceof Error ? error.message : "unknown alias send failure",
    });
  }
}
