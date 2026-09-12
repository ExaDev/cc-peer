import { describe, expect, test } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  chmod,
  utimes,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  capAttachments,
  materialiseAttachment,
  MAX_FILE_BYTES,
  spoolDir,
  stageFile,
  sweepSpool,
} from "./file-transfer.js";
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

describe("stageFile", () => {
  test("rejects a file over the 30 MiB cap", async () => {
    const home = await tempHome();
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

  test("an unreadable staged file reports expiry", async () => {
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
    await expect(
      (async () => {
        const { stat } = await import("node:fs/promises");
        await stat(oldStaged);
      })(),
    ).rejects.toThrow();
    const { stat } = await import("node:fs/promises");
    expect((await stat(freshStaged)).isFile()).toBe(true);
    expect((await stat(keepDir)).isDirectory()).toBe(true);
    await rm(join(dir, "broken-link"), { force: true });
  });
});
