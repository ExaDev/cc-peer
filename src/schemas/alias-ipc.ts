import { z } from "zod";
import { defineSchema } from "./define-schema.js";

/**
 * The parent-to-child and child-to-parent IPC contract `AliasPool`'s Node adapter (`adapters/node/forked-alias-process.ts`) and worker (`adapters/node/alias-worker.ts`) exchange over `child_process.fork()`'s built-in channel. This is deliberately independent of the wire protocol schemas in `wire.ts`: it never touches a socket, it only carries commands and events between a pool and the real OS process backing one reply alias.
 */
export const AliasStartCommandSchema = defineSchema(
  z.object({
    type: z.literal("start"),
    name: z.string().min(1),
    homeDir: z.string().optional(),
    socketDir: z.string().optional(),
    sessionId: z.string().optional(),
  }),
);
export type AliasStartCommand = z.infer<typeof AliasStartCommandSchema>;

export const AliasStopCommandSchema = defineSchema(
  z.object({ type: z.literal("stop") }),
);
export type AliasStopCommand = z.infer<typeof AliasStopCommandSchema>;

export const AliasCommandSchema = defineSchema(
  z.union([AliasStartCommandSchema, AliasStopCommandSchema]),
);
export type AliasCommand = z.infer<typeof AliasCommandSchema>;

/** Sent once the worker's own CcPeer is listening and registered. */
export const AliasStartedEventSchema = defineSchema(
  z.object({ type: z.literal("started") }),
);
export type AliasStartedEvent = z.infer<typeof AliasStartedEventSchema>;

/** Mirrors CcPeer's own InboundMessage shape, carried over IPC instead of an EventEmitter within one process. */
export const AliasMessageEventSchema = defineSchema(
  z.object({
    type: z.literal("message"),
    from: z.string().optional(),
    fromSession: z.string().optional(),
    fromName: z.string().optional(),
    fromMode: z.enum(["bypass", "prompting"]).optional(),
    hopChain: z.array(z.string()).optional(),
    body: z.string(),
    msgId: z.string(),
  }),
);
export type AliasMessageEvent = z.infer<typeof AliasMessageEventSchema>;

export const AliasEventSchema = defineSchema(
  z.union([AliasStartedEventSchema, AliasMessageEventSchema]),
);
export type AliasEvent = z.infer<typeof AliasEventSchema>;
