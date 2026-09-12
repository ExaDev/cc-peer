import { z } from "zod";
import { defineSchema } from "./define-schema.js";
import { count, PEER_TOKEN_HEX_LENGTH } from "./limits.js";

/** The auth key a session publishes next to its socket. */
export const PeerKeyFileSchema = defineSchema(
  z.object({
    peerToken: z
      .string()
      .regex(new RegExp(`^[0-9a-f]{${count(PEER_TOKEN_HEX_LENGTH)}}$`)),
    procStart: z.string().min(1),
    pidDomain: z.string().min(1),
  }),
);

export type PeerKeyFile = z.infer<typeof PeerKeyFileSchema>;
