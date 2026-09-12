import { describe, expect, test } from "vitest";
import {
  CcPeerError,
  TransportError,
  NoLiveInboxError,
  UnknownPeerError,
  MessageTooLargeError,
  UnvettedReplyTargetError,
  NotStartedError,
  ProtocolError,
} from "./errors.js";

describe("error taxonomy", () => {
  test("every error carries its machine-readable code", () => {
    const cases = [
      [new TransportError("t"), "TRANSPORT"],
      [new NoLiveInboxError("n"), "NO_LIVE_INBOX"],
      [new UnknownPeerError("u"), "UNKNOWN_PEER"],
      [new MessageTooLargeError("m"), "MESSAGE_TOO_LARGE"],
      [new UnvettedReplyTargetError("v"), "UNVETTED_REPLY_TARGET"],
      [new NotStartedError("s"), "NOT_STARTED"],
      [new ProtocolError("p"), "PROTOCOL"],
    ] as const;
    for (const [error, code] of cases) {
      expect(error).toBeInstanceOf(CcPeerError);
      expect(error.code).toBe(code);
      expect(error.message).toBeTruthy();
    }
  });
});
