import { describe, expect, test } from "vitest";
import {
  appendHop,
  checkChain,
  MAX_CHAIN_LENGTH_GUARD,
  MAX_SELF_HOPS,
} from "./hop-chain.js";

const id = (n: number) => n.toString(16).padStart(24, "0");
const ownToken = "21cc6f3d5c60ce84a36b2054";

describe("hop-chain", () => {
  test("appendHop trims to the grammar maximum", () => {
    const chain = Array.from({ length: 32 }, (_, i) => id(i + 1));
    const next = appendHop(chain, ownToken);
    expect(next).toHaveLength(32);
    expect(next.at(-1)).toBe(ownToken);
    expect(next[0]).toBe(id(2));
  });

  test("appendHop does not trim when landing exactly at the grammar maximum", () => {
    const chain = Array.from({ length: 31 }, (_, i) => id(i + 1));
    const next = appendHop(chain, ownToken);
    expect(next).toHaveLength(32);
    expect(next[0]).toBe(id(1));
    expect(next.at(-1)).toBe(ownToken);
  });

  test("runaway fires above the guard length but not at it", () => {
    const at = Array.from({ length: MAX_CHAIN_LENGTH_GUARD }, (_, i) =>
      id(i + 1),
    );
    expect(checkChain(at, new Set()).admitted).toBe(true);
    const over = [...at, id(999)];
    expect(checkChain(over, new Set())).toEqual({
      admitted: false,
      reason: "hop-runaway",
    });
  });

  test("loop fires at maxSelfHops own-token occurrences, not below", () => {
    const below = Array.from({ length: MAX_SELF_HOPS - 1 }, () => ownToken);
    expect(checkChain(below, new Set([ownToken])).admitted).toBe(true);
    const at = Array.from({ length: MAX_SELF_HOPS }, () => ownToken);
    expect(checkChain(at, new Set([ownToken]))).toEqual({
      admitted: false,
      reason: "hop-loop",
    });
  });

  test("a single own-token occurrence is harmless (verified protocol behaviour)", () => {
    expect(checkChain([ownToken], new Set([ownToken])).admitted).toBe(true);
  });
});
