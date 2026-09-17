import { z } from "zod";
import {
  MAX_ADDRESS_CHARS,
  PEER_TOKEN_HEX_LENGTH,
  SHA256_HEX_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_YIELD_SLUGS,
  MAX_SLUG_CHARS,
  MAX_MSG_ID_CHARS,
  MAX_SESSION_ID_CHARS,
  MAX_ADDRESS_FIELD_CHARS,
  count,
} from "./limits.js";
import { defineSchema } from "./define-schema.js";

/** Line 1 of every connection: the receiver's own peerToken (peer class) or childToken (self-sent class). */
export const AuthLineSchema = defineSchema(
  z.object({
    type: z.literal("auth"),
    token: z
      .string()
      .regex(new RegExp(`^[0-9a-f]{${count(PEER_TOKEN_HEX_LENGTH)}}$`)),
  }),
);
export type AuthLine = z.infer<typeof AuthLineSchema>;

export const PrioritySchema = defineSchema(z.enum(["next", "later"]));
export type Priority = z.infer<typeof PrioritySchema>;

export const FileAttachmentSchema = defineSchema(
  z.object({
    path: z.string().min(1),
    file_name: z.string().min(1),
    file_size: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(new RegExp(`^[0-9a-f]{${count(SHA256_HEX_LENGTH)}}$`)),
    media_type: z.string().optional(),
  }),
);
export type FileAttachment = z.infer<typeof FileAttachmentSchema>;

/** A user-turn message. `"type": "user"` is load-bearing: any other value is silently dropped. */
export const UserFrameSchema = defineSchema(
  z.object({
    msgV: z.number().int(),
    msg_id: z.string().min(1),
    type: z.literal("user"),
    message: z.object({
      role: z.literal("user"),
      content: z.string(),
    }),
    priority: PrioritySchema,
    from: z
      .string()
      .regex(
        new RegExp(`^[A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}}$`),
      ),
    /** When present, must match the receiver's sessionId or the frame is silently dropped. */
    session_id: z.string().optional(),
    file_attachments: z
      .array(FileAttachmentSchema)
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
  }),
);
export type UserFrame = z.infer<typeof UserFrameSchema>;

export const DropReasonSchema = defineSchema(
  z.enum([
    "rate-limited",
    "duplicate",
    "hop-loop",
    "hop-runaway",
    "queue-full",
  ]),
);
export type DropReason = z.infer<typeof DropReasonSchema>;

export const PeerMessageStatusSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("peer_message_status"),
    status: z.enum(["held", "delivered", "denied", "expired", "dropped"]),
    reason: z.string(),
    from: z
      .string()
      .regex(
        new RegExp(`^[A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}}$`),
      ),
    orig_msg_id: z.string().min(1),
    status_detail: z.string().optional(),
    drop_reason: DropReasonSchema.optional(),
    dropped_msg_ids: z.array(z.string()).optional(),
    msgV: z.number().int(),
    msg_id: z.string().min(1),
  }),
);
export type PeerMessageStatus = z.infer<typeof PeerMessageStatusSchema>;

export const NotifyWhenIdleSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("notify_when_idle"),
    from: z
      .string()
      .regex(
        new RegExp(`^[A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}}$`),
      ),
    from_mode: z.enum(["bypass", "prompting"]).optional(),
    msgV: z.number().int(),
    msg_id: z.string().min(1),
  }),
);
export type NotifyWhenIdle = z.infer<typeof NotifyWhenIdleSchema>;

export const PeerIdleNoticeSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("peer_idle_notice"),
    orig_msg_id: z.string().min(1),
    state: z.enum(["idle", "exited"]),
    finished_at: z.number(),
    detail: z.string().optional(),
    from: z
      .string()
      .regex(
        new RegExp(`^[A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}}$`),
      ),
    from_mode: z.enum(["bypass", "prompting"]).optional(),
    msgV: z.number().int(),
    msg_id: z.string().min(1),
  }),
);
export type PeerIdleNotice = z.infer<typeof PeerIdleNoticeSchema>;

/** Bare enum, exported separately so a test can assert its own membership directly rather than through the object field's .catch("claim") fallback, which would otherwise mask a corrupted "claim" member by coincidentally recovering the same value. */
export const YieldReasonSchema = z.enum(["resume", "claim"]);

export const YieldArtifactRepliesSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("yield_artifact_replies"),
    from: z.string().max(MAX_ADDRESS_FIELD_CHARS),
    msg_id: z.string().min(1).max(MAX_MSG_ID_CHARS),
    session_id: z.string().max(MAX_SESSION_ID_CHARS),
    slugs: z.array(z.string().max(MAX_SLUG_CHARS)).max(MAX_YIELD_SLUGS),
    reason: YieldReasonSchema.catch("claim"),
    sent_at: z.number(),
    claimed_at: z.number().optional(),
    requester: z
      .object({ cwd: z.string().optional(), tmux: z.string().optional() })
      .optional(),
    msgV: z.number().int(),
  }),
);
export type YieldArtifactReplies = z.infer<typeof YieldArtifactRepliesSchema>;

export const ArtifactRepliesYieldedSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("artifact_replies_yielded"),
    orig_msg_id: z.string().max(MAX_MSG_ID_CHARS),
    yielded: z.string().optional(),
    not_held: z.string().optional(),
    refused: z.string().optional(),
    msgV: z.number().int(),
    msg_id: z.string().min(1),
    from: z.string().optional(),
  }),
);
export type ArtifactRepliesYielded = z.infer<
  typeof ArtifactRepliesYieldedSchema
>;

export const UnyieldArtifactRepliesSchema = defineSchema(
  z.object({
    type: z.literal("control"),
    action: z.literal("unyield_artifact_replies"),
    orig_msg_id: z.string().max(MAX_MSG_ID_CHARS),
    slugs: z.array(z.string().max(MAX_SLUG_CHARS)).max(MAX_YIELD_SLUGS),
    stopped: z.boolean().optional(),
    msgV: z.number().int(),
    msg_id: z.string().min(1),
    from: z.string().optional(),
  }),
);
export type UnyieldArtifactReplies = z.infer<
  typeof UnyieldArtifactRepliesSchema
>;

export const ControlFrameSchema = z.union([
  PeerMessageStatusSchema,
  NotifyWhenIdleSchema,
  PeerIdleNoticeSchema,
  YieldArtifactRepliesSchema,
  ArtifactRepliesYieldedSchema,
  UnyieldArtifactRepliesSchema,
]);
export type ControlFrame = z.infer<typeof ControlFrameSchema>;

export const WireFrameSchema = z.union([UserFrameSchema, ControlFrameSchema]);
export type WireFrame = z.infer<typeof WireFrameSchema>;
