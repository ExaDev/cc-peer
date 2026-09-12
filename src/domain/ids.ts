import { randomUUID, randomBytes } from "node:crypto";
import { HOP_ID_BYTES } from "../schemas/limits.js";

/** Message ids are UUID v4, matching the reference client's `qM()`. */
export function newMsgId(): string {
  return randomUUID();
}

/** Hop-chain entries are 24-hex ids derived from 12 random bytes. */
export function newHopId(): string {
  return randomBytes(HOP_ID_BYTES).toString("hex");
}
