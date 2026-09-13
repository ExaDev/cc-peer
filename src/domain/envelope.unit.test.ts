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
    expect(once).toBe("says <\\> then more");
    expect(escapeBody(once)).toBe(once);
    const env = buildEnvelope({ from: "uds:/tmp/x.sock" }, body);
    expect(assertRoundTrips(env)).toBe(true);
  });

  test("a hop chain of multiple ids serialises with comma separators", () => {
    const env = buildEnvelope(
      {
        from: "uds:/tmp/x.sock",
        hopChain: ["21cc6f3d5c60ce84a36b2054", "aaaaaaaaaaaaaaaaaaaaaaaa"],
      },
      "x",
    );
    expect(env).toContain(
      'hop-chain="21cc6f3d5c60ce84a36b2054,aaaaaaaaaaaaaaaaaaaaaaaa"',
    );
    expect(assertRoundTrips(env)).toBe(true);
  });

  test("a body carrying an unescaped closing tag in the middle fails to round-trip", () => {
    // The greedy body capture runs to the LAST closing tag in the content, so a raw, never-escaped closing tag earlier in the body is swallowed into the parsed body rather than terminating the match early. Rebuilding re-escapes that embedded tag, producing a different string than the untrusted original — exactly the case this check exists to reject.
    const content =
      '<cross-session-message from="uds:/tmp/x.sock">\nfirst part </cross-session-message> more text\n</cross-session-message>';
    expect(assertRoundTrips(content)).toBe(false);
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

  test("an empty hop chain serialises without the attribute", () => {
    const env = buildEnvelope(
      { from: "uds:/tmp/cc-socks/1.sock", hopChain: [] },
      "x",
    );
    expect(env).not.toContain("hop-chain");
    expect(assertRoundTrips(env)).toBe(true);
  });

  test("from-name quotes are stripped on build", () => {
    const env = buildEnvelope(
      { from: "uds:/tmp/cc-socks/1.sock", fromName: 'say "hi"' },
      "x",
    );
    expect(env).toContain('from-name="say hi"');
  });

  test("a from-only envelope parses with every other field absent", () => {
    const env =
      '<cross-session-message from="uds:/tmp/cc-socks/1.sock">\nbody only\n</cross-session-message>';
    const parsed = parseEnvelope(env);
    expect(parsed?.from).toBe("uds:/tmp/cc-socks/1.sock");
    expect(parsed?.fromSession).toBeUndefined();
    expect(parsed?.hopChain).toBeUndefined();
    expect(parsed?.fromName).toBeUndefined();
    expect(parsed?.fromMode).toBeUndefined();
    expect(parsed?.body).toBe("body only");
    expect(assertRoundTrips(env)).toBe(true);
    // Absent fields must be omitted keys, not keys explicitly set to undefined: only a genuinely omitted key is safe to spread into a downstream object without shadowing a real value there.
    expect(parsed === undefined ? [] : Object.keys(parsed)).toEqual([
      "body",
      "from",
    ]);
  });

  test("a from-less envelope parses but cannot round-trip", () => {
    const env = "<cross-session-message>\nanonymous\n</cross-session-message>";
    const parsed = parseEnvelope(env);
    expect(parsed?.from).toBeUndefined();
    expect(parsed?.body).toBe("anonymous");
    expect(assertRoundTrips(env)).toBe(false);
    // "from" must be an omitted key here, not a key explicitly set to undefined, matching the same omit-vs-explicit-undefined contract as every other optional field.
    expect(parsed === undefined ? [] : Object.keys(parsed)).toEqual(["body"]);
  });
});
