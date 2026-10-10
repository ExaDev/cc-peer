import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { selectProcInfo } from "../../cc-peer.js";
import { withPlatform } from "../../test/with-platform.js";
import { LinuxProcInfo } from "./linux-proc-info.js";
import { PsProcInfo } from "./ps-proc-info.js";
import { WinProcInfo } from "./win-proc-info.js";

async function tempProcRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-proc-"));
}

describe("LinuxProcInfo", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeStat(pid: number, line: string): Promise<string> {
    const root = await tempProcRoot();
    dirs.push(root);
    const procDir = join(root, pid.toString());
    await mkdir(procDir, { recursive: true });
    await writeFile(join(procDir, "stat"), line);

    return root;
  }

  test("returns field 22 for a normal comm", async () => {
    const root = await writeStat(
      4242,
      "4242 (node) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 249560752 0 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0",
    );
    const info = new LinuxProcInfo(root);
    expect(await info.lstart(4242)).toBe("249560752");
  });

  test("parses past a comm containing spaces and a closing paren", async () => {
    const root = await writeStat(
      4343,
      "4343 (my weird ) proc) S 1 4343 4343 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 99999 0 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0",
    );
    const info = new LinuxProcInfo(root);
    expect(await info.lstart(4343)).toBe("99999");
  });

  test("a missing /proc/<pid>/stat file reads as undefined", async () => {
    const root = await tempProcRoot();
    dirs.push(root);
    const info = new LinuxProcInfo(root);
    expect(await info.lstart(9999)).toBeUndefined();
  });

  test("nothing after the comm's closing paren reads as undefined", async () => {
    const root = await writeStat(4545, "4545 (node)\n");
    const info = new LinuxProcInfo(root);
    expect(await info.lstart(4545)).toBeUndefined();
  });

  test("a non-numeric field 22 reads as undefined", async () => {
    const root = await writeStat(
      4444,
      "4444 (node) S 1 4444 4444 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 not-a-number 0 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0",
    );
    const info = new LinuxProcInfo(root);
    expect(await info.lstart(4444)).toBeUndefined();
  });
});

describe("selectProcInfo", () => {
  test("picks LinuxProcInfo on linux, WinProcInfo on win32, PsProcInfo elsewhere", async () => {
    await withPlatform("linux", () => {
      expect(selectProcInfo()).toBeInstanceOf(LinuxProcInfo);
    });
    await withPlatform("win32", () => {
      expect(selectProcInfo()).toBeInstanceOf(WinProcInfo);
    });
    await withPlatform("darwin", () => {
      expect(selectProcInfo()).toBeInstanceOf(PsProcInfo);
    });
  });
});
