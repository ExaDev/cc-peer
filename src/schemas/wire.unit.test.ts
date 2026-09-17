import { describe, expect, test } from "vitest";
import {
  AuthLineSchema,
  FileAttachmentSchema,
  UserFrameSchema,
  DropReasonSchema,
  PeerMessageStatusSchema,
  NotifyWhenIdleSchema,
  PeerIdleNoticeSchema,
  YieldArtifactRepliesSchema,
  YieldReasonSchema,
  ArtifactRepliesYieldedSchema,
  UnyieldArtifactRepliesSchema,
} from "./wire.js";

const VALID_ATTACHMENT = {
  path: "/tmp/staged-file.bin",
  file_name: "report.pdf",
  file_size: 4096,
  sha256: "a".repeat(64),
};

describe("FileAttachmentSchema", () => {
  test("accepts a fully-shaped attachment", () => {
    expect(FileAttachmentSchema.is(VALID_ATTACHMENT)).toBe(true);
  });

  test("rejects a missing required field", () => {
    expect(FileAttachmentSchema.is({})).toBe(false);
  });

  test("rejects a sha256 that does not match the hex-64 shape", () => {
    expect(
      FileAttachmentSchema.is({ ...VALID_ATTACHMENT, sha256: "not-hex" }),
    ).toBe(false);
  });
});

const VALID_USER_FRAME = {
  msgV: 1,
  msg_id: "msg-outbound-1",
  type: "user",
  message: { role: "user", content: "hello there" },
  priority: "next",
  from: "uds:/tmp/cc-socks/123.sock",
};

describe("UserFrameSchema", () => {
  test("accepts a fully-shaped user frame", () => {
    expect(UserFrameSchema.is(VALID_USER_FRAME)).toBe(true);
  });

  test("rejects a nested message missing its own required fields", () => {
    expect(UserFrameSchema.is({ ...VALID_USER_FRAME, message: {} })).toBe(
      false,
    );
  });

  test("rejects a from address containing a disallowed character", () => {
    expect(UserFrameSchema.is({ ...VALID_USER_FRAME, from: "has space" })).toBe(
      false,
    );
  });

  test("accepts a single file attachment, under the per-message cap", () => {
    expect(
      UserFrameSchema.is({
        ...VALID_USER_FRAME,
        file_attachments: [VALID_ATTACHMENT],
      }),
    ).toBe(true);
  });
});

describe("DropReasonSchema", () => {
  test("every documented drop reason is accepted", () => {
    for (const reason of [
      "rate-limited",
      "duplicate",
      "hop-loop",
      "hop-runaway",
      "queue-full",
    ]) {
      expect(DropReasonSchema.is(reason)).toBe(true);
    }
    expect(DropReasonSchema.is("made-up-reason")).toBe(false);
  });
});

const VALID_PEER_MESSAGE_STATUS = {
  type: "control",
  action: "peer_message_status",
  status: "delivered",
  reason: "",
  from: "uds:/tmp/cc-socks/123.sock",
  orig_msg_id: "msg-outbound-1",
  msgV: 1,
  msg_id: "msg-status-1",
};

describe("PeerMessageStatusSchema", () => {
  test("accepts a fully-shaped status frame", () => {
    expect(PeerMessageStatusSchema.is(VALID_PEER_MESSAGE_STATUS)).toBe(true);
  });

  test("rejects an incomplete object", () => {
    expect(PeerMessageStatusSchema.is({})).toBe(false);
  });

  test("every documented status value is accepted", () => {
    for (const status of [
      "held",
      "delivered",
      "denied",
      "expired",
      "dropped",
    ]) {
      expect(
        PeerMessageStatusSchema.is({
          ...VALID_PEER_MESSAGE_STATUS,
          status,
        }),
      ).toBe(true);
    }
  });

  test("rejects a from address containing a disallowed character", () => {
    expect(
      PeerMessageStatusSchema.is({
        ...VALID_PEER_MESSAGE_STATUS,
        from: "has space",
      }),
    ).toBe(false);
  });
});

const VALID_NOTIFY_WHEN_IDLE = {
  type: "control",
  action: "notify_when_idle",
  from: "uds:/tmp/cc-socks/123.sock",
  msgV: 1,
  msg_id: "msg-notify-1",
};

describe("NotifyWhenIdleSchema", () => {
  test("accepts a fully-shaped frame", () => {
    expect(NotifyWhenIdleSchema.is(VALID_NOTIFY_WHEN_IDLE)).toBe(true);
  });

  test("rejects an incomplete object", () => {
    expect(NotifyWhenIdleSchema.is({})).toBe(false);
  });

  test("rejects a from address containing a disallowed character", () => {
    expect(
      NotifyWhenIdleSchema.is({ ...VALID_NOTIFY_WHEN_IDLE, from: "bad char" }),
    ).toBe(false);
  });

  test("every documented from_mode value is accepted", () => {
    for (const from_mode of ["bypass", "prompting"]) {
      expect(
        NotifyWhenIdleSchema.is({ ...VALID_NOTIFY_WHEN_IDLE, from_mode }),
      ).toBe(true);
    }
    expect(
      NotifyWhenIdleSchema.is({
        ...VALID_NOTIFY_WHEN_IDLE,
        from_mode: "made-up",
      }),
    ).toBe(false);
  });
});

const VALID_PEER_IDLE_NOTICE = {
  type: "control",
  action: "peer_idle_notice",
  orig_msg_id: "msg-outbound-1",
  state: "idle",
  finished_at: 1_726_000_000_000,
  from: "uds:/tmp/cc-socks/123.sock",
  msgV: 1,
  msg_id: "msg-idle-1",
};

describe("PeerIdleNoticeSchema", () => {
  test("accepts a fully-shaped frame", () => {
    expect(PeerIdleNoticeSchema.is(VALID_PEER_IDLE_NOTICE)).toBe(true);
  });

  test("every documented state value is accepted", () => {
    for (const state of ["idle", "exited"]) {
      expect(
        PeerIdleNoticeSchema.is({ ...VALID_PEER_IDLE_NOTICE, state }),
      ).toBe(true);
    }
    expect(
      PeerIdleNoticeSchema.is({ ...VALID_PEER_IDLE_NOTICE, state: "napping" }),
    ).toBe(false);
  });

  test("rejects a from address containing a disallowed character", () => {
    expect(
      PeerIdleNoticeSchema.is({ ...VALID_PEER_IDLE_NOTICE, from: "bad char" }),
    ).toBe(false);
  });

  test("every documented from_mode value is accepted", () => {
    for (const from_mode of ["bypass", "prompting"]) {
      expect(
        PeerIdleNoticeSchema.is({ ...VALID_PEER_IDLE_NOTICE, from_mode }),
      ).toBe(true);
    }
    expect(
      PeerIdleNoticeSchema.is({
        ...VALID_PEER_IDLE_NOTICE,
        from_mode: "made-up",
      }),
    ).toBe(false);
  });
});

const VALID_YIELD_ARTIFACT_REPLIES = {
  type: "control",
  action: "yield_artifact_replies",
  from: "raw-socket-peer",
  msg_id: "msg-yield-1",
  session_id: "session-abc-123",
  slugs: ["design-doc", "spec-outline"],
  reason: "resume",
  sent_at: 1_726_000_000_000,
  msgV: 1,
};

describe("YieldArtifactRepliesSchema", () => {
  test("accepts a fully-shaped frame", () => {
    expect(YieldArtifactRepliesSchema.is(VALID_YIELD_ARTIFACT_REPLIES)).toBe(
      true,
    );
  });

  test("rejects an incomplete object", () => {
    expect(YieldArtifactRepliesSchema.is({})).toBe(false);
  });

  test("both documented reasons are genuine enum members, not just recoverable via the catch fallback", () => {
    // Checking the field through YieldArtifactRepliesSchema can't distinguish a corrupted "claim" member from a healthy one: .catch("claim") means a rejected "claim" input recovers to exactly "claim" anyway, so the field-level result looks identical either way. YieldReasonSchema is the bare enum with no catch, so a genuinely corrupted member fails safeParse here instead of being silently repaired.
    expect(YieldReasonSchema.safeParse("resume").success).toBe(true);
    expect(YieldReasonSchema.safeParse("claim").success).toBe(true);
  });

  test("an unrecognised reason falls back to claim rather than failing validation", () => {
    const parsed = YieldArtifactRepliesSchema.parse({
      ...VALID_YIELD_ARTIFACT_REPLIES,
      reason: "made-up",
    });
    expect(parsed.reason).toBe("claim");
  });

  test("accepts a well-typed requester and rejects a wrongly-typed one", () => {
    expect(
      YieldArtifactRepliesSchema.is({
        ...VALID_YIELD_ARTIFACT_REPLIES,
        requester: { cwd: "/home/user/project", tmux: "session-1" },
      }),
    ).toBe(true);
    expect(
      YieldArtifactRepliesSchema.is({
        ...VALID_YIELD_ARTIFACT_REPLIES,
        requester: { cwd: 12345 },
      }),
    ).toBe(false);
  });
});

const VALID_ARTIFACT_REPLIES_YIELDED = {
  type: "control",
  action: "artifact_replies_yielded",
  orig_msg_id: "msg-yield-1",
  msgV: 1,
  msg_id: "msg-yielded-1",
};

describe("ArtifactRepliesYieldedSchema", () => {
  test("accepts a fully-shaped frame", () => {
    expect(
      ArtifactRepliesYieldedSchema.is(VALID_ARTIFACT_REPLIES_YIELDED),
    ).toBe(true);
  });

  test("rejects an incomplete object", () => {
    expect(ArtifactRepliesYieldedSchema.is({})).toBe(false);
  });
});

const VALID_UNYIELD_ARTIFACT_REPLIES = {
  type: "control",
  action: "unyield_artifact_replies",
  orig_msg_id: "msg-yield-1",
  slugs: ["design-doc", "spec-outline"],
  msgV: 1,
  msg_id: "msg-unyield-1",
};

describe("UnyieldArtifactRepliesSchema", () => {
  test("accepts a fully-shaped frame", () => {
    expect(
      UnyieldArtifactRepliesSchema.is(VALID_UNYIELD_ARTIFACT_REPLIES),
    ).toBe(true);
  });

  test("rejects an incomplete object", () => {
    expect(UnyieldArtifactRepliesSchema.is({})).toBe(false);
  });
});

describe("AuthLineSchema companion coverage", () => {
  test("accepts the documented auth shape", () => {
    expect(AuthLineSchema.is({ type: "auth", token: "a".repeat(32) })).toBe(
      true,
    );
  });
});
