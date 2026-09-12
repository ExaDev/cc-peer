import { z } from "zod";
import { defineSchema } from "./define-schema.js";
import {
  HOP_ID_HEX_LENGTH,
  MAX_ADDRESS_CHARS,
  MAX_FROM_NAME_CHARS,
  MAX_HOP_CHAIN_ENTRIES,
  MAX_SESSION_REF_CHARS,
  count,
} from "./limits.js";

/**
 * Grammar of the <cross-session-message> envelope attributes, mirroring the receiver's own parser. The serialized attribute ORDER is canonical (from, from-session, hop-chain, from-name, from-mode): the receiver's regex matches that sequence only, so any other order parses as nothing.
 */
export const EnvelopeAddressSchema = defineSchema(
  z
    .string()
    .regex(
      new RegExp(`^[A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}}$`),
    ),
);
export type EnvelopeAddress = z.infer<typeof EnvelopeAddressSchema>;

export const FromModeSchema = defineSchema(z.enum(["bypass", "prompting"]));
export type FromMode = z.infer<typeof FromModeSchema>;

export const HopIdSchema = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${count(HOP_ID_HEX_LENGTH)}}$`));
export type HopId = z.infer<typeof HopIdSchema>;

export const EnvelopeAttributesSchema = defineSchema(
  z.object({
    from: EnvelopeAddressSchema,
    fromSession: z
      .string()
      .regex(new RegExp(`^[A-Za-z0-9_-]{1,${count(MAX_SESSION_REF_CHARS)}}$`))
      .optional(),
    /** Parsed hop chain: at most 32 ids at the grammar level. */
    hopChain: z.array(HopIdSchema).max(MAX_HOP_CHAIN_ENTRIES).optional(),
    fromName: z.string().min(1).max(MAX_FROM_NAME_CHARS).optional(),
    fromMode: FromModeSchema.optional(),
  }),
);
export type EnvelopeAttributes = z.infer<typeof EnvelopeAttributesSchema>;
