import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materialiseAttachment, stageFile } from "./file-transfer.js";
import type { FileAttachment } from "../schemas/wire.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-ft-"));
}

describe("file transfer", () => {
  test("staging and materialisation round-trip", async () => {
    const home = await tempHome();
    const source = join(home, "hello.txt");
    const content = "attachment bytes " + "x".repeat(64);
    await writeFile(source, content, "utf8");
    const descriptor: FileAttachment = await stageFile(home, source);
    expect(descriptor.file_size).toBe(content.length);
    const ok = await materialiseAttachment(home, "session-rx", descriptor);
    expect(typeof ok).toBe("object");
    const uploadPath = typeof ok === "object" ? ok.uploadPath : "";
    expect(
      await (await import("node:fs/promises")).readFile(uploadPath, "utf8"),
    ).toBe(content);
    expect(typeof ok === "object" ? ok.mention : "").toContain('@"');
  });

  test("integrity mismatch fails verification", async () => {
    const home = await tempHome();
    const source = join(home, "again.txt");
    await writeFile(source, "hello.txt again", "utf8");
    const reStaged: FileAttachment = await stageFile(home, source);
    const bad = await materialiseAttachment(home, "session-rx", {
      ...reStaged,
      sha256: "0".repeat(64),
    });
    expect(bad).toContain("failed integrity verification");
  });

  test("paths outside the spool are refused", async () => {
    const home = await tempHome();
    const source = join(home, "third.txt");
    await writeFile(source, "second file", "utf8");
    const second: FileAttachment = await stageFile(home, source);
    const outside = await materialiseAttachment(home, "session-rx", {
      ...second,
      path: "/etc/hostname",
    });
    expect(outside).toContain("outside the file-transfer spool");
  });
});
