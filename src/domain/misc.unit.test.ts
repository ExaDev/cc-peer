import { describe, expect, test } from "vitest";
import { DEDUP_WINDOW_MS, varyBody } from "./dedup.js";
import { newHopId, newMsgId } from "./ids.js";

describe("dedup", () => {
  test("window is the receiver's 30s", () => {
    expect(DEDUP_WINDOW_MS).toBe(30_000);
  });

  test("varyBody appends distinct invisible variation per nth", () => {
    const body = "same text";
    const first = varyBody(body, 0);
    const second = varyBody(body, 1);
    expect(first).not.toBe(second);
    expect(first.startsWith(body)).toBe(true);
    expect(second.startsWith(body)).toBe(true);
    expect(varyBody(body, 0)).toBe(first);
  });
});

describe("ids", () => {
  test("msg ids are uuid v4 shaped", () => {
    expect(newMsgId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("hop ids are 24 lowercase hex", () => {
    expect(newHopId()).toMatch(/^[0-9a-f]{24}$/);
  });
});
