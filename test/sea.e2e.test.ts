import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import { SEA_BINARY_STARTUP_TIMEOUT_MS } from "../src/test/timeouts.js";

/**
 * Exercises the actual packaged single-executable artifact CI ships, not the in-process TS modules every other tier tests: a real, separate process, started the way an end user would, over the network. Requires CC_PEER_SEA_BINARY (the path to a binary already built by scripts/build-sea.ts) — this test does not build one itself, since a SEA build needs a Node distribution with the feature enabled and takes real time, neither of which belongs in a test's own setup.
 */
const BINARY = process.env.CC_PEER_SEA_BINARY;

/** How often waitForPort re-probes the binary's own health endpoint while it is still starting up. */
const POLL_INTERVAL_MS = 100;

/** Headroom over SEA_BINARY_STARTUP_TIMEOUT_MS for the outer test() timeout, so waitForPort's own deadline always elapses and this test's own diagnostic Error (captured stderr, process exit info) is what surfaces as the failure — not vitest's generic "Test timed out" abort, which would win the race and discard it if the two timeouts were equal. */
const TEST_TIMEOUT_HEADROOM_MS = 10_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === "string") {
          reject(new Error("expected the probe server to report a port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForPort(port: number, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port.toString()}/healthz`,
      );
      if (response.ok) return;
    } catch {
      // Not accepting connections yet; keep polling until the deadline.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `cc-peer did not start listening within ${deadlineMs.toString()}ms`,
      );
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      timer.unref();
    });
  }
}

describe.skipIf(BINARY === undefined)("packaged SEA binary", () => {
  test(
    "starts as a real process and serves the REST facade over the network",
    async () => {
      if (BINARY === undefined) {
        throw new Error("unreachable: describe.skipIf already guards this");
      }
      const home = await mkdtemp(join(tmpdir(), "cc-peer-e2e-"));
      const port = await freePort();
      const child = spawn(
        BINARY,
        [
          "--home",
          home,
          "--port",
          port.toString(),
          "--no-token",
          "--name",
          "sea-e2e",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      let exitInfo = "process is still running";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        // Logged as it arrives, not only from the catch block below: vitest's own test-level timeout can abort this test before that block ever runs, which would otherwise discard every diagnostic this test exists to capture.
        console.error(`[sea-e2e stderr] ${text}`);
      });
      child.once("exit", (code, signal) => {
        exitInfo = `process exited: code=${String(code)} signal=${String(signal)}`;
        console.error(`[sea-e2e] ${exitInfo}`);
      });
      child.once("error", (error) => {
        exitInfo = `process failed to spawn: ${error.message}`;
        console.error(`[sea-e2e] ${exitInfo}`);
      });
      try {
        await waitForPort(port, SEA_BINARY_STARTUP_TIMEOUT_MS);

        const health = await fetch(
          `http://127.0.0.1:${port.toString()}/healthz`,
        );
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ ok: true });

        const spec = await fetch(
          `http://127.0.0.1:${port.toString()}/openapi.json`,
        );
        expect(spec.status).toBe(200);
        const document = (await spec.json()) as { openapi: string };
        expect(document.openapi).toBe("3.1.0");

        const sessions = await fetch(
          `http://127.0.0.1:${port.toString()}/sessions`,
        );
        expect(sessions.status).toBe(200);
      } catch (error) {
        throw new Error(
          `SEA binary smoke test failed (${exitInfo}); captured stderr:\n${stderr}`,
          { cause: error },
        );
      } finally {
        child.kill();
      }
    },
    SEA_BINARY_STARTUP_TIMEOUT_MS + TEST_TIMEOUT_HEADROOM_MS,
  );
});
