import { describe, expect, test } from "vitest";
import {
  AliasStartCommandSchema,
  AliasStopCommandSchema,
  AliasCommandSchema,
  AliasStartedEventSchema,
  AliasMessageEventSchema,
  AliasEventSchema,
  AliasSendTargetSchema,
  AliasSendCommandSchema,
  AliasSentEventSchema,
  AliasSendFailedEventSchema,
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

const VALID_SEND_COMMAND = {
  type: "send",
  requestId: "req-1",
  target: { pid: 4242 },
  body: "pong",
};

describe("AliasSendTargetSchema", () => {
  test("accepts each of the three ways a peer can be addressed", () => {
    expect(AliasSendTargetSchema.is({ pid: 4242 })).toBe(true);
    expect(AliasSendTargetSchema.is({ name: "alice" })).toBe(true);
    expect(
      AliasSendTargetSchema.is({ address: "uds:/tmp/cc-socks/9.sock" }),
    ).toBe(true);
  });

  test("rejects an empty name or address", () => {
    expect(AliasSendTargetSchema.is({ name: "" })).toBe(false);
    expect(AliasSendTargetSchema.is({ address: "" })).toBe(false);
  });

  test("rejects a target mixing two ways of addressing the same peer", () => {
    expect(AliasSendTargetSchema.is({ pid: 4242, name: "alice" })).toBe(false);
  });

  test("rejects a target addressing nothing at all", () => {
    expect(AliasSendTargetSchema.is({})).toBe(false);
  });
});

describe("AliasSendCommandSchema", () => {
  test("accepts a well-formed send command", () => {
    expect(AliasSendCommandSchema.is(VALID_SEND_COMMAND)).toBe(true);
  });

  test("accepts an empty body", () => {
    expect(AliasSendCommandSchema.is({ ...VALID_SEND_COMMAND, body: "" })).toBe(
      true,
    );
  });

  test("rejects an empty requestId", () => {
    expect(
      AliasSendCommandSchema.is({ ...VALID_SEND_COMMAND, requestId: "" }),
    ).toBe(false);
  });

  test("rejects a missing body", () => {
    expect(
      AliasSendCommandSchema.is({
        type: "send",
        requestId: "req-1",
        target: { pid: 4242 },
      }),
    ).toBe(false);
  });

  test("rejects an unaddressable target", () => {
    expect(
      AliasSendCommandSchema.is({
        ...VALID_SEND_COMMAND,
        target: { socket: "/tmp/cc-socks/9.sock" },
      }),
    ).toBe(false);
  });

  test("rejects a wrong type discriminant", () => {
    expect(
      AliasSendCommandSchema.is({ ...VALID_SEND_COMMAND, type: "start" }),
    ).toBe(false);
  });
});

describe("AliasCommandSchema", () => {
  test("accepts every command shape", () => {
    expect(AliasCommandSchema.is({ type: "start", name: "alice" })).toBe(true);
    expect(AliasCommandSchema.is({ type: "stop" })).toBe(true);
    expect(AliasCommandSchema.is(VALID_SEND_COMMAND)).toBe(true);
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

const VALID_SENT_EVENT = {
  type: "sent",
  requestId: "req-1",
  msgId: "msg-1",
};

const VALID_SEND_FAILED_EVENT = {
  type: "send_failed",
  requestId: "req-1",
  code: "NO_LIVE_INBOX",
  message: "no auth key published",
};

describe("AliasSentEventSchema", () => {
  test("accepts a well-formed acknowledgement", () => {
    expect(AliasSentEventSchema.is(VALID_SENT_EVENT)).toBe(true);
  });

  test("rejects an empty requestId or msgId", () => {
    expect(
      AliasSentEventSchema.is({ ...VALID_SENT_EVENT, requestId: "" }),
    ).toBe(false);
    expect(AliasSentEventSchema.is({ ...VALID_SENT_EVENT, msgId: "" })).toBe(
      false,
    );
  });

  test("rejects a wrong type discriminant", () => {
    expect(AliasSentEventSchema.is({ ...VALID_SENT_EVENT, type: "send" })).toBe(
      false,
    );
  });
});

describe("AliasSendFailedEventSchema", () => {
  test("accepts a well-formed failure", () => {
    expect(AliasSendFailedEventSchema.is(VALID_SEND_FAILED_EVENT)).toBe(true);
  });

  test("accepts an empty message, since a code alone still identifies the failure", () => {
    expect(
      AliasSendFailedEventSchema.is({
        ...VALID_SEND_FAILED_EVENT,
        message: "",
      }),
    ).toBe(true);
  });

  test("rejects an empty code", () => {
    expect(
      AliasSendFailedEventSchema.is({ ...VALID_SEND_FAILED_EVENT, code: "" }),
    ).toBe(false);
  });

  test("rejects a missing requestId", () => {
    expect(
      AliasSendFailedEventSchema.is({
        type: "send_failed",
        code: "TRANSPORT",
        message: "gone",
      }),
    ).toBe(false);
  });
});

describe("AliasEventSchema", () => {
  test("accepts every event shape", () => {
    expect(AliasEventSchema.is({ type: "started" })).toBe(true);
    expect(AliasEventSchema.is(VALID_MESSAGE_EVENT)).toBe(true);
    expect(AliasEventSchema.is(VALID_SENT_EVENT)).toBe(true);
    expect(AliasEventSchema.is(VALID_SEND_FAILED_EVENT)).toBe(true);
  });

  test("rejects an unrelated shape", () => {
    expect(AliasEventSchema.is({ type: "pong" })).toBe(false);
  });
});
