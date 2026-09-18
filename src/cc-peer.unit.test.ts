import { expect, test } from "vitest";
import { CC_PEER_VERSION } from "./cc-peer.js";
import packageJson from "../package.json" with { type: "json" };

test("exports cc-peer's own real package version, not a placeholder", () => {
  expect(CC_PEER_VERSION).toBe(packageJson.version);
});
