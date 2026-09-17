import { describe, expect, test } from "vitest";
import {
  AliasStartCommandSchema,
  AliasStopCommandSchema,
  AliasCommandSchema,
  AliasStartedEventSchema,
  AliasMessageEventSchema,
  AliasEventSchema,
} from "./alias-ipc.js";

describe("AliasStartCommandSchema", () => {
  test("accepts a name-only start command", () => {
    expect(AliasStartCommandSchema.is({ type: "start", name: "alice" })).toBe(
      true,
    );
  });

  test("accepts optional homeDir, socketDir, and sessionId", () => {
    expect(
      AliasStartCommandSchema.is({
        type: "start",
        name: "alice",
        homeDir: "/tmp/home",
        socketDir: "/tmp/socks",
        sessionId: "sess-1",
      }),
    ).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(AliasStartCommandSchema.is({ type: "start", name: "" })).toBe(false);
  });

  test("rejects a wrong type discriminant", () => {
    expect(AliasStartCommandSchema.is({ type: "stop", name: "alice" })).toBe(
      false,
    );
  });
});

describe("AliasStopCommandSchema", () => {
  test("accepts a bare stop command", () => {
    expect(AliasStopCommandSchema.is({ type: "stop" })).toBe(true);
  });

  test("rejects a wrong type discriminant", () => {
    expect(AliasStopCommandSchema.is({ type: "start" })).toBe(false);
  });
});

describe("AliasCommandSchema", () => {
  test("accepts either command shape", () => {
    expect(AliasCommandSchema.is({ type: "start", name: "alice" })).toBe(true);
    expect(AliasCommandSchema.is({ type: "stop" })).toBe(true);
  });

  test("rejects an unrelated shape", () => {
    expect(AliasCommandSchema.is({ type: "ping" })).toBe(false);
  });
});

describe("AliasStartedEventSchema", () => {
  test("accepts the bare started event", () => {
    expect(AliasStartedEventSchema.is({ type: "started" })).toBe(true);
  });

  test("rejects a wrong type discriminant", () => {
    expect(AliasStartedEventSchema.is({ type: "message" })).toBe(false);
  });
});

const VALID_MESSAGE_EVENT = {
  type: "message",
  body: "hello",
  msgId: "msg-1",
};

describe("AliasMessageEventSchema", () => {
  test("accepts the minimal required shape", () => {
    expect(AliasMessageEventSchema.is(VALID_MESSAGE_EVENT)).toBe(true);
  });

  test("accepts every optional attribution field", () => {
    expect(
      AliasMessageEventSchema.is({
        ...VALID_MESSAGE_EVENT,
        from: "uds:/tmp/cc-socks/9.sock",
        fromSession: "sess-9",
        fromName: "hopper",
        fromMode: "bypass",
        hopChain: ["a".repeat(24)],
      }),
    ).toBe(true);
  });

  test("rejects a missing body", () => {
    expect(
      AliasMessageEventSchema.is({ type: "message", msgId: "msg-1" }),
    ).toBe(false);
  });

  test("rejects an invalid fromMode value", () => {
    expect(
      AliasMessageEventSchema.is({
        ...VALID_MESSAGE_EVENT,
        fromMode: "bogus",
      }),
    ).toBe(false);
  });

  test("accepts both fromMode enum members", () => {
    expect(
      AliasMessageEventSchema.is({
        ...VALID_MESSAGE_EVENT,
        fromMode: "prompting",
      }),
    ).toBe(true);
  });
});

describe("AliasEventSchema", () => {
  test("accepts either event shape", () => {
    expect(AliasEventSchema.is({ type: "started" })).toBe(true);
    expect(AliasEventSchema.is(VALID_MESSAGE_EVENT)).toBe(true);
  });

  test("rejects an unrelated shape", () => {
    expect(AliasEventSchema.is({ type: "pong" })).toBe(false);
  });
});
