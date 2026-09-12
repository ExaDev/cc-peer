import { z } from "zod";

import { defineSchema } from "../schemas/define-schema.js";
import { RegistryEntrySchema } from "../schemas/registry.js";
import { PrioritySchema } from "../schemas/wire.js";

/** Address a REST target by session pid, roster name, or raw address. */
export const PeerTargetSchema = defineSchema(
  z
    .object({
      pid: z.number().int().positive().optional(),
      name: z.string().min(1).optional(),
      address: z.string().min(1).optional(),
    })
    .refine(
      (t) =>
        t.pid !== undefined || t.name !== undefined || t.address !== undefined,
      { message: "target must specify pid, name, or address" },
    )
    .meta({ id: "PeerTarget", title: "Peer target" }),
);
export type PeerTarget = z.infer<typeof PeerTargetSchema>;

export const SendMessageRequestSchema = defineSchema(
  z
    .object({
      to: PeerTargetSchema,
      body: z.string().min(1),
      priority: PrioritySchema.optional(),
      /** false deliberately sends unattested (the recipient holds it). */
      fromMode: z
        .union([z.enum(["bypass", "prompting"]), z.literal(false)])
        .optional(),
    })
    .meta({ id: "SendMessageRequest", title: "Send message request" }),
);
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const IdleSubscriptionRequestSchema = defineSchema(
  z.object({ to: PeerTargetSchema }).meta({
    id: "IdleSubscriptionRequest",
    title: "Idle subscription request",
  }),
);
export type IdleSubscriptionRequest = z.infer<
  typeof IdleSubscriptionRequestSchema
>;

export const SendAcceptedSchema = defineSchema(
  z
    .object({ msgId: z.string() })
    .meta({ id: "SendAccepted", title: "Send accepted" }),
);
export type SendAccepted = z.infer<typeof SendAcceptedSchema>;

export const RosterResponseSchema = defineSchema(
  z
    .object({ sessions: z.array(RegistryEntrySchema) })
    .meta({ id: "RosterResponse", title: "Roster response" }),
);
export type RosterResponse = z.infer<typeof RosterResponseSchema>;

export const ErrorResponseSchema = defineSchema(
  z
    .object({ error: z.string() })
    .meta({ id: "ErrorResponse", title: "Error response" }),
);
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * The schemas that become OpenAPI 3.1 components. OpenAPI 3.1 component schemas are JSON Schema 2020-12, so z.toJSONSchema with that target converts each definition losslessly; ids come from .meta() so components are named and reusable rather than inlined per-operation.
 */
export const API_COMPONENT_SCHEMAS = {
  PeerTarget: PeerTargetSchema,
  SendMessageRequest: SendMessageRequestSchema,
  IdleSubscriptionRequest: IdleSubscriptionRequestSchema,
  SendAccepted: SendAcceptedSchema,
  RosterResponse: RosterResponseSchema,
  ErrorResponse: ErrorResponseSchema,
} as const;
