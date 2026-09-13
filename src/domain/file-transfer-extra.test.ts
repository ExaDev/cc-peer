import { describe, expect, test } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  chmod,
  stat,
  readdir,
  utimes,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  capAttachments,
  materialiseAttachment,
  MAX_FILE_BYTES,
  spoolDir,
  stageFile,
  sweepSpool,
  uploadsDir,
} from "./file-transfer.js";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../schemas/limits.js";
import type { FileAttachment } from "../schemas/wire.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-ft2-"));
}

const DAY_MS = 86_400_000;

function attachment(
  overrides: Readonly<Partial<FileAttachment>> = {},
): FileAttachment {
  return {
    path: "/tmp/staged-file",
    file_name: "a.txt",
    file_size: 2,
    sha256: "0".repeat(64),
    ...overrides,
  };
}

describe("path helpers", () => {
  test("spoolDir and uploadsDir use the exact reference segments", async () => {
    const home = await tempHome();
    expect(spoolDir(home)).toBe(join(home, ".claude", "file-transfers"));
    expect(uploadsDir(home, "sess-1")).toBe(
      join(home, ".claude", "uploads", "sess-1"),
    );
  });
});

describe("stageFile", () => {
  test("accepts a file at exactly the 30 MiB cap and rejects one byte over", async () => {
    const home = await tempHome();
    const atCap = join(home, "at-cap.bin");
    await writeFile(atCap, Buffer.alloc(MAX_FILE_BYTES, 7));
    await expect(stageFile(home, atCap)).resolves.toBeDefined();

    const big = join(home, "big.bin");
    await writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1, 7));
    await expect(stageFile(home, big)).rejects.toThrow("exceeds");
  });

  test("sanitises unicode names to underscore forms", async () => {
    const home = await tempHome();
    const source = join(home, "héllo.txt");
    await writeFile(source, "hi", "utf8");
    const descriptor = await stageFile(home, source);
    expect(descriptor.file_name).toBe("héllo.txt");
    expect(descriptor.path).toContain("h_llo.txt");
  });

  test("staged file names use 8-character sha256 and uuid prefixes", async () => {
    const home = await tempHome();
    const source = join(home, "sized.txt");
    await writeFile(source, "prefix check content", "utf8");
    const descriptor = await stageFile(home, source);
    expect(basename(descriptor.path)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{8}-sized\.txt$/,
    );
  });

  // NTFS has no POSIX permission-bit model: writeFile's mode option only ever toggles the read-only attribute there, so a real owner-only 0600 is a POSIX-only guarantee to begin with, not something Claude Code's own protocol depends on cross-platform.
  test.skipIf(process.platform === "win32")(
    "staged files are written owner-only",
    async () => {
      const home = await tempHome();
      const source = join(home, "sized2.txt");
      await writeFile(source, "prefix check content", "utf8");
      const descriptor = await stageFile(home, source);
      const info = await stat(descriptor.path);
      expect((info.mode & 0o777).toString(8)).toBe("600");
    },
  );
});

describe("materialiseAttachment refusals", () => {
  test("a relative path is refused", async () => {
    const home = await tempHome();
    const result = await materialiseAttachment(
      home,
      "s",
      attachment({ path: "relative/x" }),
    );
    expect(result).toContain("invalid transfer path");
  });

  test("a vanished staged file reports expiry", async () => {
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(dir, { recursive: true });
    const result = await materialiseAttachment(
      home,
      "s",
      attachment({ path: join(dir, "gone-file") }),
    );
    expect(result).toContain("may have expired");
  });

  test("a directory inside the spool is not a regular file", async () => {
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(join(dir, "a-directory"), { recursive: true });
    const result = await materialiseAttachment(
      home,
      "s",
      attachment({ path: join(dir, "a-directory") }),
    );
    expect(result).toContain("not a regular file");
  });

  // NTFS has no POSIX permission-bit model: chmod(0o000) there only ever clears the read-only attribute's own opposite bit and never removes owner read access, so the file the code under test opens stays readable and the expiry branch this test means to exercise is unreachable.
  test.skipIf(process.platform === "win32")(
    "an unreadable staged file reports expiry",
    async () => {
      const home = await tempHome();
      const source = join(home, "locked.txt");
      await writeFile(source, "secret", "utf8");
      const descriptor = await stageFile(home, source);
      await chmod(descriptor.path, 0o000);
      try {
        const result = await materialiseAttachment(home, "s", descriptor);
        expect(result).toContain("may have expired");
      } finally {
        await chmod(descriptor.path, 0o600);
        await rm(descriptor.path, { force: true });
      }
    },
  );

  test("a size mismatch alone fails verification even when the hash is correct for the real bytes", async () => {
    const home = await tempHome();
    const source = join(home, "sized-mismatch.txt");
    await writeFile(source, "exact content", "utf8");
    const descriptor = await stageFile(home, source);
    const result = await materialiseAttachment(home, "s", {
      ...descriptor,
      file_size: descriptor.file_size + 1,
    });
    expect(result).toContain("failed integrity verification");
  });

  test("the delivered file lands under an 8-character sha256 and uuid prefixed name", async () => {
    const home = await tempHome();
    const source = join(home, "deliver-me.txt");
    await writeFile(source, "deliver me", "utf8");
    const descriptor = await stageFile(home, source);
    const result = await materialiseAttachment(home, "s", descriptor);
    expect(typeof result).toBe("object");
    const uploadPath = typeof result === "object" ? result.uploadPath : "";
    expect(basename(uploadPath)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{8}-deliver-me\.txt$/,
    );
  });
});

describe("capAttachments", () => {
  test("a batch under the cap passes through whole with no note", () => {
    const batch = Array.from({ length: 5 }, (_, i) =>
      attachment({ file_name: `f${i.toString()}.txt` }),
    );
    const { kept, droppedNote } = capAttachments(batch);
    expect(kept).toHaveLength(5);
    expect(droppedNote).toBeUndefined();
  });

  test("a batch over the cap is truncated with a dropped note", () => {
    const batch = Array.from({ length: 17 }, (_, i) =>
      attachment({ file_name: `f${i.toString()}.txt` }),
    );
    const { kept, droppedNote } = capAttachments(batch);
    expect(kept).toHaveLength(16);
    expect(droppedNote).toContain("1 additional attachment");
  });

  test("a batch of exactly the cap size passes through whole with no note", () => {
    const batch = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) =>
      attachment({ file_name: `f${i.toString()}.txt` }),
    );
    const { kept, droppedNote } = capAttachments(batch);
    expect(kept).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(droppedNote).toBeUndefined();
  });
});

describe("sweepSpool", () => {
  test("a missing spool directory is a no-op", async () => {
    const home = await tempHome();
    await expect(sweepSpool(home, Date.now())).resolves.toBeUndefined();
  });

  test("old files are removed, fresh files and directories survive, broken links are skipped", async () => {
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(dir, { recursive: true });
    const now = Date.now();

    const old = join(home, "old.txt");
    await writeFile(old, "old", "utf8");
    const oldStaged = (await stageFile(home, old)).path;
    await utimes(
      oldStaged,
      new Date(now - 2 * DAY_MS),
      new Date(now - 2 * DAY_MS),
    );

    const fresh = join(home, "fresh.txt");
    await writeFile(fresh, "fresh", "utf8");
    const freshStaged = (await stageFile(home, fresh)).path;

    const keepDir = join(dir, "keep-me");
    await mkdir(keepDir, { recursive: true });
    await utimes(
      keepDir,
      new Date(now - 2 * DAY_MS),
      new Date(now - 2 * DAY_MS),
    );

    await symlink(
      join(dir, "target-that-does-not-exist"),
      join(dir, "broken-link"),
    );

    await sweepSpool(home, now);

    expect(oldStaged.startsWith(dir)).toBe(true);
    await expect(stat(oldStaged)).rejects.toThrow();
    expect((await stat(freshStaged)).isFile()).toBe(true);
    expect((await stat(keepDir)).isDirectory()).toBe(true);
    await rm(join(dir, "broken-link"), { force: true });
  });

  test("the cutoff is the full one-day retention window, not a fraction of it", async () => {
    // An hour-old file must survive against a real one-day cutoff; the arithmetic mistake this guards (dividing instead of multiplying) would push the cutoff to within a fraction of a millisecond of "now", which would incorrectly sweep this file up too.
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(dir, { recursive: true });
    const now = Date.now();
    const hourOld = join(home, "hour-old.txt");
    await writeFile(hourOld, "recent", "utf8");
    const staged = (await stageFile(home, hourOld)).path;
    const oneHourMs = 3_600_000;
    await utimes(staged, new Date(now - oneHourMs), new Date(now - oneHourMs));

    await sweepSpool(home, now);

    expect((await stat(staged)).isFile()).toBe(true);
  });

  test("a file whose mtime lands exactly on the cutoff survives (strictly older only)", async () => {
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(dir, { recursive: true });
    const now = Date.now();
    const onCutoff = join(home, "on-cutoff.txt");
    await writeFile(onCutoff, "boundary", "utf8");
    const staged = (await stageFile(home, onCutoff)).path;
    const cutoff = now - DAY_MS;
    await utimes(staged, new Date(cutoff), new Date(cutoff));

    await sweepSpool(home, now);

    expect((await stat(staged)).isFile()).toBe(true);
  });

  test("a pass never removes more than the sweep batch limit", async () => {
    const home = await tempHome();
    const dir = spoolDir(home);
    await mkdir(dir, { recursive: true });
    const now = Date.now();
    const old = new Date(now - 2 * DAY_MS);
    const SWEEP_BATCH = 200;
    const total = SWEEP_BATCH + 1;
    for (let i = 0; i < total; i += 1) {
      const path = join(dir, `batch-${i.toString().padStart(4, "0")}.txt`);
      await writeFile(path, "x", "utf8");
      await utimes(path, old, old);
    }

    await sweepSpool(home, now);

    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(1);
  });
});
