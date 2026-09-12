import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PeerKeyFileSchema } from "../src/schemas/keyfile.js";
import { RegistryEntrySchema } from "../src/schemas/registry.js";
import { EnvelopeAttributesSchema } from "../src/schemas/envelope.js";
import {
  AuthLineSchema,
  UserFrameSchema,
  PeerMessageStatusSchema,
  NotifyWhenIdleSchema,
  PeerIdleNoticeSchema,
  YieldArtifactRepliesSchema,
  ArtifactRepliesYieldedSchema,
  UnyieldArtifactRepliesSchema,
} from "../src/schemas/wire.js";

const OUT_DIR = "schemas";

const schemas: Record<string, z.ZodType> = {
  "peer-key-file": PeerKeyFileSchema,
  "registry-entry": RegistryEntrySchema,
  "envelope-attributes": EnvelopeAttributesSchema,
  "auth-line": AuthLineSchema,
  "user-frame": UserFrameSchema,
  "peer-message-status": PeerMessageStatusSchema,
  "notify-when-idle": NotifyWhenIdleSchema,
  "peer-idle-notice": PeerIdleNoticeSchema,
  "yield-artifact-replies": YieldArtifactRepliesSchema,
  "artifact-replies-yielded": ArtifactRepliesYieldedSchema,
  "unyield-artifact-replies": UnyieldArtifactRepliesSchema,
};

mkdirSync(OUT_DIR, { recursive: true });
let emitted = 0;
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" });
  // Generation must be lossless: every emitted schema must re-validate the shape it came from (catches constraints Zod cannot express in JSON Schema).
  writeFileSync(
    join(OUT_DIR, `${name}.schema.json`),
    `${JSON.stringify(json, null, 2)}\n`,
  );
  emitted += 1;
}
console.log("wrote " + String(emitted) + " schema(s) to " + OUT_DIR + "/");
