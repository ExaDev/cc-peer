import { z } from "zod";
import { defineSchema } from "./define-schema.js";

/** Whitelist the receiver applies on read; other values parse to undefined. */
export const NameSourceSchema = defineSchema(
  z.enum(["user", "peer", "derived", "collision", "auto", "hook"]),
);
export type NameSource = z.infer<typeof NameSourceSchema>;

export const PeerStatusSchema = defineSchema(
  z.enum(["busy", "shell", "idle", "waiting"]),
);
export type PeerStatus = z.infer<typeof PeerStatusSchema>;

export const SessionKindSchema = defineSchema(
  z.enum(["interactive", "bg", "daemon", "daemon-worker"]),
);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const PeerFeatureSchema = defineSchema(
  z.enum(["notify_idle", "reply_across_default_dirs", "artifact_yield"]),
);
export type PeerFeature = z.infer<typeof PeerFeatureSchema>;

/** One entry of the ~/.claude/sessions/<pid>.json registry. */
export const RegistryEntrySchema = defineSchema(
  z.object({
    pid: z.number().int().positive(),
    sessionId: z.string().min(1),
    cwd: z.string(),
    startedAt: z.number().int().nonnegative(),
    procStart: z.string().min(1),
    version: z.string().min(1),
    peerProtocol: z.number().int(),
    peerFeatures: z.array(PeerFeatureSchema),
    kind: SessionKindSchema,
    entrypoint: z.string(),
    pidDomain: z.string().min(1),
    messagingSocketPath: z.string().min(1),
    name: z.string().optional(),
    nameSource: NameSourceSchema.optional(),
    nameSince: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
    status: PeerStatusSchema.optional(),
    statusUpdatedAt: z.number().int().nonnegative().optional(),
    bridgeSessionId: z.string().optional(),
  }),
);

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
