import type { EventEmitter } from "node:events";
import type { PathConfig } from "../adapters/node/paths.js";
import type { PeerRef } from "../cc-peer.js";

export interface AliasStartOptions extends PathConfig {
  name: string;
  sessionId?: string;
}

/**
 * A synthetic, natively-discoverable Claude Code peer identity backed by a real OS process. A real process is required, not a design choice: the registry is one file per real pid with a single optional name field each (see docs/PROTOCOL.md's "Reply aliases" section), so a single process can only ever publish one discoverable name at a time. `events` emits "message" (an InboundMessage-shaped object) for each reply the alias receives, and "exit" once the backing process has ended, whether from a deliberate stop() or an unexpected crash.
 */
export interface AliasProcess {
  readonly events: EventEmitter;
  start: (options: Readonly<AliasStartOptions>) => Promise<void>;
  /**
   * Sends `body` to `target` from the alias's own peer identity, so the recipient sees the alias as the sender and replies to it natively. Resolves with the id the alias's peer gave the message; rejects with an `AliasSendError` when the alias refuses the send or its process ends before acknowledging it.
   */
  send: (target: Readonly<PeerRef>, body: string) => Promise<{ msgId: string }>;
  stop: () => Promise<void>;
}
