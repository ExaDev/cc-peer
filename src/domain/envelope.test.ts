import { describe, expect, test } from "vitest";
import {
  buildEnvelope,
  parseEnvelope,
  assertRoundTrips,
  escapeBody,
} from "./envelope.js";

/** Captured verbatim from live Claude Code 2.1.269 traffic. */
const REAL_FRAME_CONTENT =
  '<cross-session-message from="uds:/tmp/cc-socks/81322.sock" hop-chain="21cc6f3d5c60ce84a36b2054" from-name="agent-comms-06" from-mode="bypass">\nAcknowledged — this is a real Claude session replying to your control-frame experiment.\n</cross-session-message>';

describe("buildEnvelope", () => {
  test("emits canonical attribute order", () => {
    const env = buildEnvelope(
      {
        from: "uds:/tmp/cc-socks/123.sock",
        fromSession: "6eeba7a7-72d7-486c-ab45-21fda7addd9c",
        hopChain: ["21cc6f3d5c60ce84a36b2054"],
        fromName: "raw-socket-peer",
        fromMode: "bypass",
      },
      "hello",
    );
    const order = env
      .slice(0, env.indexOf(">"))
      .match(/[a-z-]+="/g)
      ?.map((a) => a.slice(0, -2));
    expect(order).toEqual([
      "from",
      "from-session",
      "hop-chain",
      "from-name",
      "from-mode",
    ]);
  });

  test("round-trips a real captured frame", () => {
    expect(assertRoundTrips(REAL_FRAME_CONTENT)).toBe(true);
  });

  test("parses the real captured frame into its parts", () => {
    const parsed = parseEnvelope(REAL_FRAME_CONTENT);
    expect(parsed?.from).toBe("uds:/tmp/cc-socks/81322.sock");
    expect(parsed?.hopChain).toEqual(["21cc6f3d5c60ce84a36b2054"]);
    expect(parsed?.fromName).toBe("agent-comms-06");
    expect(parsed?.fromMode).toBe("bypass");
    expect(parsed?.body).toContain("real Claude session replying");
  });

  test("escapes closing tags in bodies, idempotently", () => {
    const body = "says </cross-session-message> then more";
    const once = escapeBody(body);
    expect(once).not.toContain("</cross-session-message>");
    expect(escapeBody(once)).toBe(once);
    const env = buildEnvelope({ from: "uds:/tmp/x.sock" }, body);
    expect(assertRoundTrips(env)).toBe(true);
  });

  test("rejects non-canonical attribute order on parse", () => {
    const wrongOrder =
      '<cross-session-message from-name="x" from="uds:/tmp/cc-socks/1.sock" from-mode="bypass">\nbody\n</cross-session-message>';
    expect(parseEnvelope(wrongOrder)).toBeUndefined();
  });

  test("rejects an over-long hop chain at the grammar level", () => {
    const chain = Array.from({ length: 33 }, (_, i) =>
      i.toString(16).padStart(24, "0"),
    );
    const env =
      '<cross-session-message from="uds:/tmp/cc-socks/1.sock" hop-chain="' +
      chain.join(",") +
      '">\nbody\n</cross-session-message>';
    expect(parseEnvelope(env)).toBeUndefined();
  });

  test("validates attributes against the schema", () => {
    expect(() => buildEnvelope({ from: "not an address!" }, "x")).toThrow();
  });
});
