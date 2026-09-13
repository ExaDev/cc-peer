import { describe, expect, test } from "vitest";
import { appendHop, checkChain } from "./hop-chain.js";

const id = (n: number) => n.toString(16).padStart(24, "0");

describe("hop-chain edge shapes", () => {
  test("checkChain with no chain admits", () => {
    expect(checkChain(undefined, new Set())).toEqual({ admitted: true });
  });

  test("appendHop accepts an undefined chain", () => {
    const own = id(1);
    expect(appendHop(undefined, own)).toEqual([own]);
  });
});
