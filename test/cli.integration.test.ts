import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS } from "../src/test/timeouts.js";

const ENTRY = fileURLToPath(new URL("../src/bin/cc-peer.ts", import.meta.url));

/** Runs the CLI entry in a real process with an empty home, killing it if it fails to exit on its own. */
async function runCli(args: readonly string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  home: string;
}> {
  const home = await mkdtemp(join(tmpdir(), "cc-peer-cli-"));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS / 2);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, home });
    });
  });
}

describe("cc-peer CLI argument handling", () => {
  test.each([["--help"], ["-h"]])(
    "%s prints usage and exits 0 without registering a peer or minting a token",
    async (flag) => {
      const result = await runCli([flag]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: cc-peer");
      expect(result.stderr).not.toContain("bearer token");
      expect(result.stderr).not.toContain("listening");
      expect(await readdir(result.home)).toEqual([]);
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    "an unknown flag exits non-zero with a usage hint and starts nothing",
    async () => {
      const result = await runCli(["--bogus"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("unknown argument: --bogus");
      expect(result.stderr).toContain("cc-peer --help");
      expect(result.stderr).not.toContain("bearer token");
      expect(result.stderr).not.toContain("listening");
      expect(await readdir(result.home)).toEqual([]);
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );
});
