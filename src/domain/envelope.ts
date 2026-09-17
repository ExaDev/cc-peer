import type { EnvelopeAttributes } from "../schemas/envelope.js";
import { EnvelopeAttributesSchema } from "../schemas/envelope.js";
import {
  count,
  HOP_ID_HEX_LENGTH,
  MAX_ADDRESS_CHARS,
  MAX_FROM_NAME_CHARS,
  MAX_HOP_CHAIN_ENTRIES,
  MAX_SESSION_REF_CHARS,
} from "../schemas/limits.js";

const TAG = "cross-session-message";
const ONE_FEWER_THAN_CHAIN_MAX = MAX_HOP_CHAIN_ENTRIES - 1;

/**
 * The receiver's own parse shape: attributes in canonical order, each value constrained to its grammar, body between newlines. Mirrors `HB` in the reference client, including the round-trip check (rebuild-and-compare). The body is captured verbatim: escaping is applied on build only and is idempotent, so parsed bodies stay in escaped form exactly as sent.
 */
const ENVELOPE_RE = new RegExp(
  `^<${TAG}(?: from="([A-Za-z0-9%:_/.\\\\-]{1,${count(MAX_ADDRESS_CHARS)}})")?` +
    `(?: from-session="([A-Za-z0-9_-]{1,${count(MAX_SESSION_REF_CHARS)}})")?` +
    `(?: hop-chain="([0-9a-f]{${count(HOP_ID_HEX_LENGTH)}}(?:,[0-9a-f]{${count(HOP_ID_HEX_LENGTH)}}){0,${count(ONE_FEWER_THAN_CHAIN_MAX)}})")?` +
    `(?: from-name="([^"<>\\n\\r]{1,${count(MAX_FROM_NAME_CHARS)}})")?` +
    `(?: from-mode="(bypass|prompting)")?` +
    `>\\n([\\s\\S]*)\\n</${TAG}>$`,
);

/** Occurrences of the closing tag inside a body are escaped to a literal `<\`. Idempotent. */
export function escapeBody(body: string): string {
  return body.replaceAll(`</${TAG}`, "<\\");
}

/** Serialize attributes in the canonical order the receiver's regex requires. */
function serializeAttributes(attrs: EnvelopeAttributes): string {
  const parts: string[] = [];
  parts.push(` from="${attrs.from}"`);
  if (attrs.fromSession !== undefined) {
    parts.push(` from-session="${attrs.fromSession}"`);
  }
  if (attrs.hopChain !== undefined && attrs.hopChain.length > 0) {
    parts.push(` hop-chain="${attrs.hopChain.join(",")}"`);
  }
  if (attrs.fromName !== undefined) {
    parts.push(` from-name="${attrs.fromName.replaceAll('"', "")}"`);
  }
  if (attrs.fromMode !== undefined) {
    parts.push(` from-mode="${attrs.fromMode}"`);
  }
  return parts.join("");
}

export function buildEnvelope(attrs: EnvelopeAttributes, body: string): string {
  const validated = EnvelopeAttributesSchema.parse(attrs);
  return `<${TAG}${serializeAttributes(validated)}>\n${escapeBody(body)}\n</${TAG}>`;
}

export interface ParsedEnvelope {
  from?: string;
  fromSession?: string;
  hopChain?: string[];
  fromName?: string;
  fromMode?: "bypass" | "prompting";
  /** Verbatim body in escaped form, exactly as the receiver would see it. */
  body: string;
}

export function parseEnvelope(content: string): ParsedEnvelope | undefined {
  const match = ENVELOPE_RE.exec(content);
  if (match === null) return undefined;
  // The body is derived positionally from the validated content rather than read from a capture group: attribute grammars bar ">" and newlines, so the first ">\n" is the opening tag's end, and the regex anchor guarantees the "\n</tag>" suffix. This avoids an index access that
  // noUncheckedIndexedAccess would type string | undefined.
  const openingEnd = content.indexOf(">\n") + 2;
  const closingStart = content.length - `\n</${TAG}>`.length;
  const parsed: ParsedEnvelope = {
    body: content.substring(openingEnd, closingStart),
  };
  if (match[1] !== undefined) parsed.from = match[1];
  if (match[2] !== undefined) parsed.fromSession = match[2];
  if (match[3] !== undefined) parsed.hopChain = match[3].split(",");
  if (match[4] !== undefined) parsed.fromName = match[4];
  if (match[5] === "bypass" || match[5] === "prompting") {
    parsed.fromMode = match[5];
  }
  return parsed;
}

/**
 * The receiver round-trips envelopes by rebuilding them from the parsed form and comparing; an envelope that fails this is treated as unparseable. Our builders must satisfy the same invariant. Escaping is idempotent, so rebuilding from an escaped body reproduces it byte-for-byte.
 */
export function assertRoundTrips(content: string): boolean {
  const parsed = parseEnvelope(content);
  if (parsed === undefined) return false;
  // A from-less envelope cannot round-trip: buildEnvelope requires a from address, so rebuilding would throw rather than compare equal.
  if (parsed.from === undefined) return false;
  const rebuilt = buildEnvelope(
    {
      from: parsed.from,
      fromSession: parsed.fromSession,
      hopChain: parsed.hopChain,
      fromName: parsed.fromName,
      fromMode: parsed.fromMode,
    },
    parsed.body,
  );
  return rebuilt === content;
}
