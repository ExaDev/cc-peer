import { describe, expect, test } from "vitest";
import { AuthLineSchema } from "./wire.js";
import { PeerKeyFileSchema } from "./keyfile.js";
import {
  NameSourceSchema,
  PeerFeatureSchema,
  PeerStatusSchema,
  RegistryEntrySchema,
  SessionKindSchema,
} from "./registry.js";
import { EnvelopeAddressSchema, EnvelopeAttributesSchema } from "./envelope.js";
import { count } from "./limits.js";
import { componentSchemasFrom, PeerTargetSchema } from "../api/schemas.js";

describe("attached type guards reject invalid shapes", () => {
  test("auth line token must be 32 hex", () => {
    expect(AuthLineSchema.is({ type: "auth", token: "short" })).toBe(false);
    expect(AuthLineSchema.is({ type: "auth", token: "Z".repeat(32) })).toBe(
      false,
    );
    expect(AuthLineSchema.is({ type: "auth", token: "a".repeat(32) })).toBe(
      true,
    );
  });

  test("key file token must be 32 hex", () => {
    const shape = { procStart: "s", pidDomain: "darwin" };
    expect(PeerKeyFileSchema.is({ ...shape, peerToken: "x".repeat(32) })).toBe(
      false,
    );
    expect(PeerKeyFileSchema.is({ ...shape, peerToken: "a".repeat(32) })).toBe(
      true,
    );
  });

  test("registry entry requires the full shape", () => {
    expect(RegistryEntrySchema.is({})).toBe(false);
  });

  test("every documented enum value is accepted by its own schema", () => {
    for (const value of [
      "user",
      "peer",
      "derived",
      "collision",
      "auto",
      "hook",
    ]) {
      expect(NameSourceSchema.is(value)).toBe(true);
    }
    expect(NameSourceSchema.is("nonsense")).toBe(false);

    for (const value of ["busy", "shell", "idle", "waiting"]) {
      expect(PeerStatusSchema.is(value)).toBe(true);
    }
    expect(PeerStatusSchema.is("nonsense")).toBe(false);

    for (const value of ["interactive", "bg", "daemon", "daemon-worker"]) {
      expect(SessionKindSchema.is(value)).toBe(true);
    }
    expect(SessionKindSchema.is("nonsense")).toBe(false);

    for (const value of [
      "notify_idle",
      "reply_across_default_dirs",
      "artifact_yield",
    ]) {
      expect(PeerFeatureSchema.is(value)).toBe(true);
    }
    expect(PeerFeatureSchema.is("nonsense")).toBe(false);
  });

  test("envelope address charset is enforced", () => {
    expect(EnvelopeAddressSchema.is("has space!")).toBe(false);
    expect(EnvelopeAddressSchema.is("uds:/tmp/x.sock")).toBe(true);
  });

  test("envelope attributes validate the grammar", () => {
    expect(EnvelopeAttributesSchema.is({ from: "uds:/a.sock" })).toBe(true);
    expect(EnvelopeAttributesSchema.is({ from: "" })).toBe(false);
    expect(
      EnvelopeAttributesSchema.is({ from: "a", hopChain: ["nothex"] }),
    ).toBe(false);
    expect(EnvelopeAttributesSchema.is({ from: "a", fromMode: "wizard" })).toBe(
      false,
    );
    expect(
      EnvelopeAttributesSchema.is({ from: "a", fromSession: "has space" }),
    ).toBe(false);
    expect(
      EnvelopeAttributesSchema.is({ from: "a", fromSession: "sess-1_2" }),
    ).toBe(true);
  });
});

describe("peer target refine", () => {
  test("at least one addressing field is required", () => {
    expect(PeerTargetSchema.is({})).toBe(false);
    expect(PeerTargetSchema.is({ pid: 1 })).toBe(true);
    expect(PeerTargetSchema.is({ name: "bob" })).toBe(true);
    expect(PeerTargetSchema.is({ address: "uds:/tmp/1.sock" })).toBe(true);
    expect(PeerTargetSchema.is({ pid: 1, name: "bob" })).toBe(true);
  });
});

describe("componentSchemasFrom", () => {
  test("rejects non-object conversions", () => {
    expect(() => componentSchemasFrom(null)).toThrow(
      "did not produce an object",
    );
    expect(() => componentSchemasFrom([1, 2])).toThrow(
      "did not produce an object",
    );
  });

  test("rejects a missing or non-object schemas member", () => {
    expect(() => componentSchemasFrom({})).toThrow("no schemas object");
    expect(() => componentSchemasFrom({ schemas: 7 })).toThrow(
      "no schemas object",
    );
  });

  test("rejects non-object component entries", () => {
    expect(() => componentSchemasFrom({ schemas: { bad: 3 } })).toThrow(
      "component bad is not a JSON object",
    );
  });

  test("strips the root-only $schema keyword from every component", () => {
    const out = componentSchemasFrom({
      schemas: {
        one: { $schema: "https://example.com/draft", type: "object" },
        two: { type: "string" },
      },
    });
    expect(Object.keys(out).sort()).toEqual(["one", "two"]);
    expect(out.one).toEqual({ type: "object" });
    expect(out.two).toEqual({ type: "string" });
  });
});

describe("count helper", () => {
  test("stringifies numeric limits", () => {
    expect(count(24)).toBe("24");
  });
});
