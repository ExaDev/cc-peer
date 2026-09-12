import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";

import { errnoOf, PsProcInfo } from "./ps-proc-info.js";
import {
  pidFromSocketPath,
  sessionsDir,
  socketDirCandidates,
  socketPathForPid,
  tmpSuffix,
} from "./paths.js";
import { FsKeyStore } from "./fs-key-store.js";
import { FsRegistryStore } from "./fs-registry-store.js";
import { UdsTransport } from "./uds-transport.js";
import { keyFilePath } from "./paths.js";

/** A pid no OS will hand out, so ps exits nonzero for it. */
const IMPOSSIBLE_PID = 999_999_999;
/** The init process: exists for every user but is not signallable as non-root, so kill yields EPERM. */
const INIT_PID = 1;

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

describe("PsProcInfo", () => {
  const info = new PsProcInfo();

  test("alive: own pid true, dead pid false, init pid EPERM-counts-as-live", async () => {
    expect(await info.alive(process.pid)).toBe(true);
    expect(await info.alive(IMPOSSIBLE_PID)).toBe(false);
    if (process.getuid?.() !== 0) {
      expect(await info.alive(INIT_PID)).toBe(true);
    }
  });

  test("lstart: own pid yields a nonempty string, impossible pid undefined", async () => {
    const own = await info.lstart(process.pid);
    expect(typeof own).toBe("string");
    expect(own !== undefined && own.length > 0).toBe(true);
    expect(await info.lstart(IMPOSSIBLE_PID)).toBeUndefined();
  });

  test("concurrent lstart calls share one in-flight spawn", async () => {
    const fresh = new PsProcInfo();
    const [a, b] = await Promise.all([
      fresh.lstart(process.pid),
      fresh.lstart(process.pid),
    ]);
    expect(a).toBe(b);
  });

  test("a missing ps binary resolves lstart to undefined", async () => {
    const realPath = process.env.PATH;
    process.env.PATH = "/nonexistent-cc-peer-test-bin";
    try {
      const fresh = new PsProcInfo();
      expect(await fresh.lstart(process.pid)).toBeUndefined();
    } finally {
      if (realPath !== undefined) process.env.PATH = realPath;
    }
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

  test("socketPathForPid honours an explicit socketDir", () => {
    expect(socketPathForPid(4242, { socketDir: "/custom" })).toBe(
      "/custom/4242.sock",
    );
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

describe("UdsTransport connection lifecycle", () => {
  test("readLines yields written lines and ends when the client disconnects", async () => {
    const home = await tempHome();
    const sockPath = join(home, "lifecycle.sock");
    const transport = new UdsTransport();
    let received: string[] = [];
    let iterationEnded = false;
    const listener = await transport.listen(sockPath, (conn) => {
      expect(conn.peerPid()).toBeUndefined();
      void (async () => {
        for await (const line of conn.readLines()) {
          received.push(line);
        }
        iterationEnded = true;
      })();
    });
    await transport.connectWrite(sockPath, [
      '{"type":"auth"}',
      '{"type":"user"}',
    ]);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 300);
      timer.unref();
    });
    expect(received).toEqual(['{"type":"auth"}', '{"type":"user"}']);
    expect(iterationEnded).toBe(true);
    await listener.close();
    received = [];
  });

  test("closing the listener destroys an accepted open connection", async () => {
    const home = await tempHome();
    const sockPath = join(home, "accepted.sock");
    const transport = new UdsTransport();
    const listener = await transport.listen(sockPath, () => {
      void 0;
    });
    const client = connect(sockPath);
    await new Promise<void>((resolve) => {
      client.once("connect", () => {
        resolve();
      });
    });
    const closed = new Promise<void>((resolve) => {
      client.once("close", () => {
        resolve();
      });
    });
    await listener.close();
    await closed;
  });

  test("InboundConnection.close destroys the socket and ends iteration", async () => {
    const home = await tempHome();
    const sockPath = join(home, "closed-conn.sock");
    const transport = new UdsTransport();
    const lines: string[] = [];
    let ended = false;
    const listener = await transport.listen(sockPath, (conn) => {
      void (async () => {
        for await (const line of conn.readLines()) {
          lines.push(line);
          conn.close();
        }
        ended = true;
      })();
    });
    await transport.connectWrite(sockPath, ['{"only":"one"}']);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 300);
      timer.unref();
    });
    expect(lines).toEqual(['{"only":"one"}']);
    expect(ended).toBe(true);
    await listener.close();
  });

  test("connectWrite to a missing socket rejects", async () => {
    const transport = new UdsTransport();
    await expect(
      transport.connectWrite("/tmp/cc-peer-definitely-missing.sock", ["x"]),
    ).rejects.toThrow();
  });
});

describe("spawned child liveness", () => {
  test("a killed child reports dead", async () => {
    const info = new PsProcInfo();
    const child = spawn("sleep", ["5"]);
    await new Promise<void>((resolve) => {
      child.once("spawn", () => {
        resolve();
      });
    });
    expect(await info.alive(child.pid ?? IMPOSSIBLE_PID)).toBe(true);
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
    expect(await info.alive(child.pid ?? IMPOSSIBLE_PID)).toBe(false);
  });
});

describe("key file permissions", () => {
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
