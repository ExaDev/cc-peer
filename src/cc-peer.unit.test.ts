import { expect, test } from "vitest";
import { CC_PEER_VERSION } from "./cc-peer.js";

test("exports a version constant", () => {
  expect(CC_PEER_VERSION).toBe("0.0.0");
});
