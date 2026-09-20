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

/**
 * How an alias addresses an outbound send, mirroring `CcPeer`'s own `PeerRef` union. Each variant is strict so a target carrying fields from more than one variant is rejected outright rather than resolved by whichever branch happens to match first.
 */
export const AliasSendTargetSchema = defineSchema(
  z.union([
    z.strictObject({ pid: z.number() }),
    z.strictObject({ name: z.string().min(1) }),
    z.strictObject({ address: z.string().min(1) }),
  ]),
);
export type AliasSendTarget = z.infer<typeof AliasSendTargetSchema>;

/** Asks the alias's own CcPeer to send `body` to `target`; the worker answers with a sent or send_failed event carrying the same `requestId`. */
export const AliasSendCommandSchema = defineSchema(
  z.object({
    type: z.literal("send"),
    requestId: z.string().min(1),
    target: AliasSendTargetSchema,
    body: z.string(),
  }),
);
export type AliasSendCommand = z.infer<typeof AliasSendCommandSchema>;

export const AliasCommandSchema = defineSchema(
  z.union([
    AliasStartCommandSchema,
    AliasStopCommandSchema,
    AliasSendCommandSchema,
  ]),
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

/** Acknowledges the send command with the same `requestId`, carrying the id the alias's own peer gave the message. */
export const AliasSentEventSchema = defineSchema(
  z.object({
    type: z.literal("sent"),
    requestId: z.string().min(1),
    msgId: z.string().min(1),
  }),
);
export type AliasSentEvent = z.infer<typeof AliasSentEventSchema>;

/** Reports a send the alias could not make; `code` is the originating `CcPeerError`'s own machine-readable code where one was thrown. */
export const AliasSendFailedEventSchema = defineSchema(
  z.object({
    type: z.literal("send_failed"),
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string(),
  }),
);
export type AliasSendFailedEvent = z.infer<typeof AliasSendFailedEventSchema>;

export const AliasEventSchema = defineSchema(
  z.union([
    AliasStartedEventSchema,
    AliasMessageEventSchema,
    AliasSentEventSchema,
    AliasSendFailedEventSchema,
  ]),
);
export type AliasEvent = z.infer<typeof AliasEventSchema>;
