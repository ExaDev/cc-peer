import {
  count,
  HOP_ID_HEX_LENGTH,
  MAX_HOP_CHAIN_ENTRIES,
} from "../schemas/limits.js";

/** Receiver-side guard default: chains longer than this drop as hop-runaway. */
export const MAX_CHAIN_LENGTH_GUARD = 28;
/** Receiver-side guard default: this many own-token occurrences drop as hop-loop. */
export const MAX_SELF_HOPS = 10;

const HOP_ID_RE = new RegExp(`^[0-9a-f]{${count(HOP_ID_HEX_LENGTH)}}$`);

export function isHopId(value: string): boolean {
  return HOP_ID_RE.test(value);
}

export function joinChain(ids: readonly string[]): string | undefined {
  return ids.length > 0 ? ids.join(",") : undefined;
}

export function parseChain(serialized: string): string[] | undefined {
  const parts = serialized.split(",");
  return parts.every((p) => HOP_ID_RE.test(p)) ? parts : undefined;
}

/**
 * Append the relayer's own id, keeping at most the grammar-level maximum (the receiver trims to the same bound in `NDt`).
 */
export function appendHop(
  chain: readonly string[] | undefined,
  ownId: string,
): string[] {
  const next = [...(chain ?? []), ownId];
  return next.length > MAX_HOP_CHAIN_ENTRIES
    ? next.slice(next.length - MAX_HOP_CHAIN_ENTRIES)
    : next;
}

export interface ChainCheck {
  admitted: boolean;
  reason?: "hop-runaway" | "hop-loop";
}

/** Mirror the receiver's admission check: runaway on length, loop on own-token count. */
export function checkChain(
  chain: readonly string[] | undefined,
  ownTokens: ReadonlySet<string>,
): ChainCheck {
  if (chain === undefined) return { admitted: true };
  if (chain.length > MAX_CHAIN_LENGTH_GUARD) {
    return { admitted: false, reason: "hop-runaway" };
  }
  let selfHops = 0;
  for (const id of chain) {
    if (ownTokens.has(id)) selfHops += 1;
  }
  if (selfHops >= MAX_SELF_HOPS) {
    return { admitted: false, reason: "hop-loop" };
  }
  return { admitted: true };
}
