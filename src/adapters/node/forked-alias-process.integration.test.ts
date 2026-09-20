import { describe, expect, test, vi } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

import { ForkedAliasProcess } from "./forked-alias-process.js";
import { CcPeer, type InboundMessage } from "../../cc-peer.js";
import { AliasSendError, AliasStartError } from "../../errors.js";
import { REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS } from "../../test/timeouts.js";
import type { RegistryEntry } from "../../schemas/registry.js";
import type { PeerKeyFile } from "../../schemas/keyfile.js";

/**
 * Runs the real alias-worker.ts source under tsx's Node loader hook (registered in-process via --import, never a nested subprocess of its own, so fork()'s IPC channel is unaffected) rather than the built .js sibling ForkedAliasProcess uses by default. That built file only exists once this package has actually been run through tsdown; forking the real TypeScript source directly here proves the worker's own behaviour without requiring a prior `pnpm build`, matching how the SEA binary's own smoke test is instead deferred to a separate, build-gated e2e tier.
 */
const REAL_WORKER_PATH = fileURLToPath(
  new URL("./alias-worker.ts", import.meta.url),
);

function forkViaTsx(
  modulePath: string,
  args: readonly string[] | undefined,
  options: Readonly<Record<string, unknown>> | undefined,
): ChildProcess {
  return fork(modulePath, args ?? [], {
    ...options,
    execArgv: ["--import", "tsx"],
  });
}

function makeAliasProcess(): ForkedAliasProcess {
  return new ForkedAliasProcess({
    fork: forkViaTsx as typeof fork,
    workerPath: REAL_WORKER_PATH,
  });
}

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-alias-it-"));
}

async function readAliasRegistryEntry(
  homeDir: string,
  name: string,
): Promise<RegistryEntry> {
  const sessionsDir = join(homeDir, ".claude", "sessions");
  const files = await readdir(sessionsDir);
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    const raw = await readFile(join(sessionsDir, file), "utf8");
    const entry = JSON.parse(raw) as RegistryEntry;
    if (entry.name === name) return entry;
  }
  throw new Error(`no registry entry found for alias ${name}`);
}

async function readAliasKey(
  homeDir: string,
  socketPath: string,
): Promise<PeerKeyFile> {
  const sessionsDir = join(homeDir, ".claude", "sessions");
  const files = await readdir(sessionsDir);
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(socketPath).digest("hex");
  const match = files.find((f) => f.endsWith(`.${hash}.key`));
  if (match === undefined) {
    throw new Error(`no key file found for socket ${socketPath}`);
  }
  const raw = await readFile(join(sessionsDir, match), "utf8");
  return JSON.parse(raw) as PeerKeyFile;
}

/** Sends one raw wire frame to the alias's socket, mirroring the reference reproduction in docs/PROTOCOL.md. */
async function sendReplyFrame(
  socketPath: string,
  token: string,
  body: string,
): Promise<void> {
  const socket = connect(socketPath);
  await once(socket, "connect");
  const envelope = `<cross-session-message from="uds:/tmp/cc-socks/9.sock">\n${body}\n</cross-session-message>`;
  const frame = {
    msgV: 1,
    msg_id: randomUUID(),
    type: "user",
    message: { role: "user", content: envelope },
    priority: "next",
    from: "uds:/tmp/cc-socks/9.sock",
  };
  socket.write(`${JSON.stringify({ type: "auth", token })}\n`);
  socket.write(`${JSON.stringify(frame)}\n`);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 200);
    timer.unref();
  });
  socket.destroy();
}

describe("ForkedAliasProcess default fork() fallback", () => {
  test(
    "with no injected fork function, uses the real node:child_process.fork and fails fast against a nonexistent path",
    async () => {
      // Proves the `deps.fork ?? fork` fallback (used whenever no fork is injected, i.e. every real production call) computes a real, invokable fork() call rather than merely typechecking. workerPath itself is always required now (see ForkedAliasProcessDeps's own doc comment) — AliasPool.create() is what computes the real default for that (proved by alias-pool.integration.test.ts's own "default wiring" case).
      const proc = new ForkedAliasProcess({
        workerPath: "/nonexistent/alias-worker-path.js",
      });
      await expect(
        proc.start({ name: "unbuilt-default-test" }),
      ).rejects.toThrow(AliasStartError);
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );
});

/** A pid high enough that no live session in the temp home has published an inbox for it, so resolving it reaches the "no auth key" failure rather than a real socket. */
const PID_WITH_NO_PUBLISHED_INBOX = 999_999;

describe("ForkedAliasProcess.send against a real receiving peer", () => {
  test(
    "delivers a message the receiver attributes to the alias, not to the relay",
    async () => {
      const homeDir = await tempHome();
      const socketDir = join(homeDir, "socks");
      const target = await CcPeer.create({
        name: "send-target",
        homeDir,
        socketDir,
      });
      const received: InboundMessage[] = [];
      target.on("message", (message: InboundMessage) => {
        received.push(message);
      });
      const proc = makeAliasProcess();
      await proc.start({ name: "dana-send-test", homeDir, socketDir });
      const { msgId } = await proc.send(
        { pid: process.pid },
        "pong from the alias",
      );
      expect(msgId).not.toBe("");
      await vi.waitFor(() => {
        expect(received).toHaveLength(1);
      });
      expect(received[0]).toEqual(
        expect.objectContaining({
          body: "pong from the alias",
          fromName: "dana-send-test",
        }),
      );
      await proc.stop();
      await target.stop();
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    "rejects with the alias peer's own failure code when the target has no live inbox",
    async () => {
      const homeDir = await tempHome();
      const socketDir = join(homeDir, "socks");
      const proc = makeAliasProcess();
      await proc.start({ name: "erin-send-failure-test", homeDir, socketDir });
      const failing = proc.send(
        { pid: PID_WITH_NO_PUBLISHED_INBOX },
        "pong into the void",
      );
      await expect(failing).rejects.toThrow(AliasSendError);
      await expect(failing).rejects.toThrow(/NO_LIVE_INBOX/);
      await proc.stop();
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );
});

describe("ForkedAliasProcess against the real alias-worker source", () => {
  test(
    "registers a discoverable peer and relays an inbound reply",
    async () => {
      const homeDir = await tempHome();
      const socketDir = join(homeDir, "socks");
      const proc = makeAliasProcess();
      await proc.start({ name: "alice-relay-test", homeDir, socketDir });
      const entry = await readAliasRegistryEntry(homeDir, "alice-relay-test");
      const key = await readAliasKey(homeDir, entry.messagingSocketPath);
      const received: unknown[] = [];
      proc.events.on("message", (m: unknown) => {
        received.push(m);
      });
      await sendReplyFrame(
        entry.messagingSocketPath,
        key.peerToken,
        "reply from the relayed session",
      );
      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 50);
          timer.unref();
        });
      }
      expect(received).toEqual([
        expect.objectContaining({ body: "reply from the relayed session" }),
      ]);
      await proc.stop();
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    "stop() removes the registry entry and the process exits",
    async () => {
      const homeDir = await tempHome();
      const socketDir = join(homeDir, "socks");
      const proc = makeAliasProcess();
      await proc.start({ name: "bob-stop-test", homeDir, socketDir });
      await readAliasRegistryEntry(homeDir, "bob-stop-test");
      await proc.stop();
      await expect(
        readAliasRegistryEntry(homeDir, "bob-stop-test"),
      ).rejects.toThrow();
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    "rejects with AliasStartError when the worker fails to start",
    async () => {
      const root = await tempHome();
      // homeDir is the trigger, not socketDir: CcPeer.start() skips its socketDir mkdir entirely on Windows (a named pipe has no filesystem directory of its own — see cc-peer.ts's own isWindows() guard), so corrupting socketDir can never fail there regardless of nesting (confirmed: this test failed on Windows CI with exactly that approach). keys.writeForSocket() and registry.write() both mkdir into sessionsDir(homeDir) unconditionally on every platform, so corrupting homeDir instead reaches a real, unconditional mkdir() everywhere. Nesting one level inside the broken file (not pointing homeDir directly at it) is still load-bearing for the same reason established earlier: creating a genuinely new directory entry inside a file has no valid resolution on any platform, whereas recursive mkdir() against an already-existing path does not appear to verify it is actually a directory on Windows.
      const brokenFile = join(root, "not-a-directory");
      const brokenHomeDir = join(brokenFile, "home");
      await mkdir(root, { recursive: true });
      await writeFile(brokenFile, "not a directory");
      const proc = makeAliasProcess();
      await expect(
        proc.start({
          name: "carol-fail-test",
          homeDir: brokenHomeDir,
          socketDir: join(brokenHomeDir, "socks"),
        }),
      ).rejects.toThrow(AliasStartError);
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );

  test(
    "exits and removes its registry entry when its parent's IPC channel closes without a stop command",
    async () => {
      const homeDir = await tempHome();
      const socketDir = join(homeDir, "socks");
      const child = forkViaTsx(REAL_WORKER_PATH, [], {});
      const started = new Promise<void>((resolve) => {
        child.on("message", (message: unknown) => {
          if (
            typeof message === "object" &&
            message !== null &&
            "type" in message &&
            message.type === "started"
          ) {
            resolve();
          }
        });
      });
      child.send({
        type: "start",
        name: "orphan-test",
        homeDir,
        socketDir,
      });
      await started;
      await readAliasRegistryEntry(homeDir, "orphan-test");

      const exited = once(child, "exit");
      child.disconnect();
      const exitArguments: readonly unknown[] = await exited;

      expect(exitArguments[0]).toBe(0);
      await expect(
        readAliasRegistryEntry(homeDir, "orphan-test"),
      ).rejects.toThrow();
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );
});
