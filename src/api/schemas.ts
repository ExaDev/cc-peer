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
 * The schemas that become OpenAPI 3.1 components. A dedicated registry (rather than the global one) keeps conversion scoped to exactly these definitions: z.toJSONSchema(registry) emits every named schema once with interlinked refs, and the uri mapper rewrites them into OpenAPI's pointer form. OpenAPI 3.1 component schemas are JSON Schema 2020-12, so the conversion is lossless — the same definitions parse HTTP bodies at runtime, so document and validation cannot drift.
 */
/** Registry metadata shape: every entry gets an id (component name) and a title. */
export interface ApiSchemaMeta {
  id: string;
  title: string;
}

export const API_REGISTRY = z.registry<ApiSchemaMeta>();

API_REGISTRY.add(PeerTargetSchema, { id: "PeerTarget", title: "Peer target" });
API_REGISTRY.add(SendMessageRequestSchema, {
  id: "SendMessageRequest",
  title: "Send message request",
});
API_REGISTRY.add(IdleSubscriptionRequestSchema, {
  id: "IdleSubscriptionRequest",
  title: "Idle subscription request",
});
API_REGISTRY.add(SendAcceptedSchema, {
  id: "SendAccepted",
  title: "Send accepted",
});
API_REGISTRY.add(RosterResponseSchema, {
  id: "RosterResponse",
  title: "Roster response",
});
API_REGISTRY.add(ErrorResponseSchema, {
  id: "ErrorResponse",
  title: "Error response",
});

export type ApiComponentName =
  | "PeerTarget"
  | "SendMessageRequest"
  | "IdleSubscriptionRequest"
  | "SendAccepted"
  | "RosterResponse"
  | "ErrorResponse";

/** Convert the registry into OpenAPI 3.1 component schemas, refs as pointers. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function apiComponentSchemas(): Record<string, unknown> {
  // draft-2020-12 is the default target and matches OpenAPI 3.1 components.
  const converted: unknown = z.toJSONSchema(API_REGISTRY, {
    uri: (id: string) => `#/components/schemas/${id}`,
  });
  const schemas =
    isJsonObject(converted) && isJsonObject(converted.schemas)
      ? converted.schemas
      : {};
  // $schema is only valid on a root schema; OpenAPI components must omit it.
  const stripped: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    if (isJsonObject(schema) && "$schema" in schema) {
      const rest: Record<string, unknown> = { ...schema };
      delete rest.$schema;
      stripped[name] = rest;
    } else {
      stripped[name] = schema;
    }
  }
  return stripped;
}
