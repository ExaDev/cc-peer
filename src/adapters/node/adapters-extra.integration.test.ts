import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";

import { PsProcInfo } from "./ps-proc-info.js";
import { WinProcInfo } from "./win-proc-info.js";
import { UdsTransport } from "./uds-transport.js";
import { testSocketPath } from "../../test/socket-path.js";

/** A pid no OS will hand out, so ps exits nonzero for it. */
const IMPOSSIBLE_PID = 999_999_999;
/** The init process: exists for every user but is not signallable as non-root, so kill yields EPERM. */
const INIT_PID = 1;

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-ad-"));
}

// PsProcInfo is the POSIX-only adapter (CcPeer.create() only ever selects it when !isWindows()); it spawns a real ps and assumes POSIX signal-0/init-pid semantics, neither of which holds on a real Windows kernel. WinProcInfo is exercised separately below.
describe.skipIf(process.platform === "win32")("PsProcInfo", () => {
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

describe("WinProcInfo", () => {
  const info = new WinProcInfo();

  test("alive shares PsProcInfo's own signal-0 probe: own pid true, dead pid false", async () => {
    expect(await info.alive(process.pid)).toBe(true);
    expect(await info.alive(IMPOSSIBLE_PID)).toBe(false);
  });

  // Windows' own CreateProcess search order finds powershell.exe via the system directories even with PATH cleared, so there is no reliable way to simulate "missing binary" on a real Windows runner; skipped there rather than asserting something no longer true. Every POSIX runner this suite otherwise runs on genuinely has no powershell.exe on PATH, exercising the real ENOENT path. Successful parsing of real PowerShell output is validated by the Windows CI job's own end-to-end run of this class against a real powershell.exe.
  test.skipIf(process.platform === "win32")(
    "lstart resolves to undefined when powershell.exe is not on this machine",
    async () => {
      expect(await info.lstart(process.pid)).toBeUndefined();
    },
  );
});

describe("UdsTransport connection lifecycle", () => {
  test("readLines yields written lines and ends when the client disconnects", async () => {
    const home = await tempHome();
    const sockPath = testSocketPath(home, "lifecycle");
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
    const sockPath = testSocketPath(home, "accepted");
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
    const sockPath = testSocketPath(home, "closed-conn");
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
