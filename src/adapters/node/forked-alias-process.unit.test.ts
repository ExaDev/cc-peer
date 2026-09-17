import { describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { ForkedAliasProcess } from "./forked-alias-process.js";
import { AliasStartError } from "../../errors.js";

/** A fake ChildProcess: just enough of the EventEmitter + send() surface for the adapter's own protocol logic, driven manually by each test. */
class FakeChild extends EventEmitter {
  sent: unknown[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }

  emitExit(code: number | null): void {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

function makeForkedAliasProcess(child: FakeChild): {
  process: ForkedAliasProcess;
  forkCalls: unknown[][];
} {
  const forkCalls: unknown[][] = [];
  const fork = vi.fn((modulePath: string, args: unknown, options: unknown) => {
    forkCalls.push([modulePath, args, options]);
    return child as unknown as ChildProcess;
  });
  return {
    process: new ForkedAliasProcess({
      fork: fork as never,
      workerPath: "/fake/worker.js",
    }),
    forkCalls,
  };
}

describe("ForkedAliasProcess.start", () => {
  test("forks the configured worker path with no extra args", async () => {
    const child = new FakeChild();
    const { process: proc, forkCalls } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    expect(forkCalls).toEqual([["/fake/worker.js", [], {}]]);
  });

  test("sends a start command built from the given options", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({
      name: "alice",
      homeDir: "/tmp/home",
      socketDir: "/tmp/socks",
      sessionId: "sess-1",
    });
    child.emit("message", { type: "started" });
    await pending;
    expect(child.sent).toEqual([
      {
        type: "start",
        name: "alice",
        homeDir: "/tmp/home",
        socketDir: "/tmp/socks",
        sessionId: "sess-1",
      },
    ]);
  });

  test("resolves once the child sends a started acknowledgement", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    child.emit("message", { type: "started" });
    await pending;
    expect(resolved).toBe(true);
  });

  test("ignores a malformed inbound message while waiting to start", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { totally: "unrelated" });
    child.emit("message", { type: "started" });
    await expect(pending).resolves.toBeUndefined();
  });

  test("rejects with AliasStartError if the child exits before starting", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emitExit(1);
    await expect(pending).rejects.toThrow(AliasStartError);
    await expect(pending).rejects.toThrow(/exited before starting/);
  });

  test("reports a null exit code as null in the rejection message", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emitExit(null);
    await expect(pending).rejects.toThrow(/code null/);
  });
});

describe("ForkedAliasProcess message relay", () => {
  test("relays a well-formed message event to its own events emitter", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    const received: unknown[] = [];
    proc.events.on("message", (m: unknown) => {
      received.push(m);
    });
    child.emit("message", {
      type: "message",
      body: "hi",
      msgId: "m1",
      fromName: "alice",
    });
    expect(received).toEqual([{ body: "hi", msgId: "m1", fromName: "alice" }]);
  });

  test("carries every optional attribution field through untouched", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    const received: unknown[] = [];
    proc.events.on("message", (m: unknown) => {
      received.push(m);
    });
    child.emit("message", {
      type: "message",
      body: "hi",
      msgId: "m1",
      from: "uds:/tmp/cc-socks/9.sock",
      fromSession: "sess-9",
      fromName: "hopper",
      fromMode: "bypass",
      hopChain: ["a".repeat(24)],
    });
    expect(received).toEqual([
      {
        body: "hi",
        msgId: "m1",
        from: "uds:/tmp/cc-socks/9.sock",
        fromSession: "sess-9",
        fromName: "hopper",
        fromMode: "bypass",
        hopChain: ["a".repeat(24)],
      },
    ]);
  });

  test("ignores a malformed message event after starting", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    const received: unknown[] = [];
    proc.events.on("message", (m: unknown) => {
      received.push(m);
    });
    child.emit("message", { type: "message" });
    expect(received).toEqual([]);
  });

  test("emits its own exit event once the backing process exits after starting", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    const exits: unknown[] = [];
    proc.events.on("exit", () => {
      exits.push(true);
    });
    child.emitExit(0);
    expect(exits).toEqual([true]);
  });
});

describe("ForkedAliasProcess.stop", () => {
  test("sends a stop command and resolves once the child exits", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    const stopping = proc.stop();
    expect(child.sent).toContainEqual({ type: "stop" });
    child.emitExit(0);
    await stopping;
  });

  test("stopping before start() has ever been called is a harmless no-op", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    await expect(proc.stop()).resolves.toBeUndefined();
  });

  test("stopping an already-exited process is a harmless no-op", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    const pending = proc.start({ name: "alice" });
    child.emit("message", { type: "started" });
    await pending;
    child.emitExit(0);
    await expect(proc.stop()).resolves.toBeUndefined();
    expect(child.sent).not.toContainEqual({ type: "stop" });
  });
});
