import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errnoOf } from "./cached-command.js";
import {
  pidFromSocketPath,
  sessionsDir,
  socketDirCandidates,
  socketPathForPid,
  tmpSuffix,
} from "./paths.js";
import { FsKeyStore } from "./fs-key-store.js";
import { FsRegistryStore } from "./fs-registry-store.js";
import { keyFilePath } from "./paths.js";
import { withPlatform } from "../../test/with-platform.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-ad-"));
}

describe("errnoOf", () => {
  test("extracts the code from a coded Error", () => {
    const error: Error & { code?: string } = new Error("boom");
    error.code = "EPERM";
    expect(errnoOf(error)).toBe("EPERM");
  });

  test("returns empty for a plain Error, a string, and null", () => {
    expect(errnoOf(new Error("no code"))).toBe("");
    expect(errnoOf("just a string")).toBe("");
    expect(errnoOf(null)).toBe("");
  });
});

describe("paths", () => {
  test("XDG_RUNTIME_DIR adds a candidate and is absent by default order", () => {
    const had = process.env.XDG_RUNTIME_DIR;
    delete process.env.XDG_RUNTIME_DIR;
    expect(socketDirCandidates()).toHaveLength(2);
    process.env.XDG_RUNTIME_DIR = "/xdg-run";
    try {
      expect(socketDirCandidates().at(-1)).toBe("/xdg-run/cc-socks");
    } finally {
      if (had === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = had;
      }
    }
  });

  test("pidFromSocketPath returns 0 for a non-numeric basename", () => {
    expect(pidFromSocketPath("/tmp/cc-socks/foo.sock")).toBe(0);
  });

  test("pidFromSocketPath parses a named-pipe path by its own shape, regardless of the current platform", () => {
    expect(pidFromSocketPath("\\\\.\\pipe\\cc-peer-4242")).toBe(4242);
    expect(pidFromSocketPath("\\\\.\\pipe\\cc-peer-not-a-pid")).toBe(0);
  });

  test("socketPathForPid honours an explicit socketDir on POSIX", async () => {
    await withPlatform("darwin", () => {
      expect(socketPathForPid(4242, { socketDir: "/custom" })).toBe(
        "/custom/4242.sock",
      );
    });
  });

  test("socketPathForPid falls back to the default candidate directory on POSIX with no config", async () => {
    await withPlatform("darwin", () => {
      expect(socketPathForPid(4242)).toBe(
        `${socketDirCandidates()[0]}/4242.sock`,
      );
    });
  });

  test("socketPathForPid produces a named-pipe path on Windows", async () => {
    await withPlatform("win32", () => {
      expect(socketPathForPid(4242)).toBe("\\\\.\\pipe\\cc-peer-4242");
    });
  });

  test("socketPathForPid namespaces the pipe name by socketDir on Windows, since a pipe has no directory of its own to keep callers apart", async () => {
    await withPlatform("win32", () => {
      const a = socketPathForPid(4242, { socketDir: "/tmp/cc-peer-a" });
      const b = socketPathForPid(4242, { socketDir: "/tmp/cc-peer-b" });
      expect(a).not.toBe(b);
      expect(a).not.toBe("\\\\.\\pipe\\cc-peer-4242");
      expect(a.startsWith("\\\\.\\pipe\\cc-peer-")).toBe(true);
      expect(a.endsWith("-4242")).toBe(true);
      expect(pidFromSocketPath(a)).toBe(4242);
      expect(socketPathForPid(4242, { socketDir: "/tmp/cc-peer-a" })).toBe(a);
    });
  });

  test("sessionsDir falls back to the real home without config", () => {
    expect(sessionsDir()).toContain(".claude");
  });

  test("tmpSuffix embeds the pid", () => {
    expect(tmpSuffix()).toBe(`tmp-${process.pid.toString()}`);
  });
});

describe("FsKeyStore", () => {
  test("corrupt and schema-invalid key files read as undefined", async () => {
    const home = await tempHome();
    const store = new FsKeyStore({ homeDir: home });
    const sockPath = "/tmp/cc-socks/5001.sock";
    await mkdir(join(home, ".claude", "sessions"), { recursive: true });
    const target = keyFilePath(sockPath, { homeDir: home });
    await writeFile(target, "not json at all");
    expect(await store.readForSocket(sockPath)).toBeUndefined();
    await writeFile(target, '{"peerToken":"tooshort","procStart":"s"}');
    expect(await store.readForSocket(sockPath)).toBeUndefined();
  });

  test("removeForSocket on a missing key resolves", async () => {
    const home = await tempHome();
    const store = new FsKeyStore({ homeDir: home });
    await expect(
      store.removeForSocket("/tmp/cc-socks/5002.sock"),
    ).resolves.toBeUndefined();
  });
});

describe("FsRegistryStore", () => {
  test("list on a missing sessions dir is empty", async () => {
    const home = await tempHome();
    const store = new FsRegistryStore({ homeDir: home });
    expect(await store.list()).toEqual([]);
  });

  test("corrupt and schema-invalid entries are skipped", async () => {
    const home = await tempHome();
    const store = new FsRegistryStore({ homeDir: home });
    const dir = join(home, ".claude", "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "6001.json"), "not json");
    await writeFile(join(dir, "6002.json"), '{"pid":6002}');
    await writeFile(join(dir, "ignored.txt"), "");
    expect(await store.list()).toEqual([]);
    expect(await store.read(6001)).toBeUndefined();
    expect(await store.read(6002)).toBeUndefined();
  });

  test("touch on a missing entry is a no-op and removes resolve", async () => {
    const home = await tempHome();
    const store = new FsRegistryStore({ homeDir: home });
    await expect(store.touch(7001)).resolves.toBeUndefined();
    await expect(store.remove(7002)).resolves.toBeUndefined();
  });

  test("touch on a status-less entry leaves statusUpdatedAt untouched", async () => {
    const home = await tempHome();
    const store = new FsRegistryStore({ homeDir: home });
    await store.write({
      pid: 7101,
      sessionId: "s",
      cwd: "/",
      startedAt: 1,
      procStart: "p",
      version: "v",
      peerProtocol: 1,
      peerFeatures: [],
      kind: "interactive",
      entrypoint: "cli",
      pidDomain: "darwin",
      messagingSocketPath: "/tmp/cc-socks/7101.sock",
      updatedAt: 1,
    });
    await store.touch(7101);
    const entry = await store.read(7101);
    expect(entry?.statusUpdatedAt).toBeUndefined();
    expect(entry !== undefined && entry.updatedAt > 1).toBe(true);
  });
});

// NTFS has no POSIX permission-bit model: chmod(0o000) there doesn't remove owner read access, so the file the code under test opens stays readable and the "unreadable" branch this test means to exercise never triggers.
describe.skipIf(process.platform === "win32")("key file permissions", () => {
  test("an unreadable staged key surfaces as undefined rather than throwing", async () => {
    const home = await tempHome();
    const store = new FsKeyStore({ homeDir: home });
    const sockPath = "/tmp/cc-socks/5201.sock";
    await store.writeForSocket(sockPath, {
      peerToken: "b".repeat(32),
      procStart: "Sat Sep 12 10:47:31 2026",
      pidDomain: "darwin",
    });
    const target = keyFilePath(sockPath, { homeDir: home });
    await chmod(target, 0o000);
    expect(await store.readForSocket(sockPath)).toBeUndefined();
    await chmod(target, 0o600);
    expect((await store.readForSocket(sockPath))?.peerToken).toBe(
      "b".repeat(32),
    );
  });
});
