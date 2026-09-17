import { MAX_HOP_CHAIN_ENTRIES } from "../schemas/limits.js";

/** Receiver-side guard default: chains longer than this drop as hop-runaway. */
export const MAX_CHAIN_LENGTH_GUARD = 28;
/** Receiver-side guard default: this many own-token occurrences drop as hop-loop. */
export const MAX_SELF_HOPS = 10;

/**
 * Append the relayer's own id, keeping at most the grammar-level maximum (the receiver trims to the same bound in `NDt`). Always slicing (rather than branching on whether trimming is needed) means the maths alone decides the result: slicing from a non-positive start is a no-op in JS, so a chain already at or under the maximum is returned unchanged without a separate comparison to get right.
 */
export function appendHop(
  chain: readonly string[] | undefined,
  ownId: string,
): string[] {
  const next = [...(chain ?? []), ownId];
  return next.slice(Math.max(0, next.length - MAX_HOP_CHAIN_ENTRIES));
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
