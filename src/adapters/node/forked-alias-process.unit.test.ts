import { describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { ForkedAliasProcess } from "./forked-alias-process.js";
import { AliasSendError, AliasStartError } from "../../errors.js";
import { AliasSendCommandSchema } from "../../schemas/alias-ipc.js";

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

/** The requestId the adapter generated for its most recent send command, read back off the fake child's own IPC log so tests can answer the exact request. */
function lastSendRequestId(child: FakeChild): string {
  const command = child.sent.at(-1);
  if (!AliasSendCommandSchema.is(command)) {
    throw new Error("the last IPC command was not a send command");
  }
  return command.requestId;
}

async function startedProcess(): Promise<{
  child: FakeChild;
  proc: ForkedAliasProcess;
}> {
  const child = new FakeChild();
  const { process: proc } = makeForkedAliasProcess(child);
  const pending = proc.start({ name: "alice" });
  child.emit("message", { type: "started" });
  await pending;
  return { child, proc };
}

describe("ForkedAliasProcess.send", () => {
  test("sends a send command carrying the target and body", async () => {
    const { child, proc } = await startedProcess();
    const pending = proc.send({ pid: 42 }, "pong");
    expect(child.sent.at(-1)).toEqual({
      type: "send",
      requestId: lastSendRequestId(child),
      target: { pid: 42 },
      body: "pong",
    });
    child.emit("message", {
      type: "sent",
      requestId: lastSendRequestId(child),
      msgId: "m1",
    });
    await expect(pending).resolves.toEqual({ msgId: "m1" });
  });

  test("gives each send its own request id", async () => {
    const { child, proc } = await startedProcess();
    const first = proc.send({ pid: 42 }, "one");
    const firstRequestId = lastSendRequestId(child);
    const second = proc.send({ pid: 42 }, "two");
    const secondRequestId = lastSendRequestId(child);
    expect(secondRequestId).not.toBe(firstRequestId);
    child.emit("message", {
      type: "sent",
      requestId: secondRequestId,
      msgId: "m2",
    });
    child.emit("message", {
      type: "sent",
      requestId: firstRequestId,
      msgId: "m1",
    });
    await expect(first).resolves.toEqual({ msgId: "m1" });
    await expect(second).resolves.toEqual({ msgId: "m2" });
  });

  test("rejects with the worker's own failure code and message", async () => {
    const { child, proc } = await startedProcess();
    const pending = proc.send({ name: "bob" }, "pong");
    child.emit("message", {
      type: "send_failed",
      requestId: lastSendRequestId(child),
      code: "NO_LIVE_INBOX",
      message: "no auth key published",
    });
    await expect(pending).rejects.toThrow(AliasSendError);
    await expect(pending).rejects.toThrow(
      "NO_LIVE_INBOX: no auth key published",
    );
  });

  test("ignores an acknowledgement naming a request it is not waiting on", async () => {
    const { child, proc } = await startedProcess();
    const pending = proc.send({ pid: 42 }, "pong");
    const requestId = lastSendRequestId(child);
    child.emit("message", {
      type: "sent",
      requestId: "someone-elses-request",
      msgId: "stray",
    });
    child.emit("message", {
      type: "send_failed",
      requestId: "someone-elses-request",
      code: "TRANSPORT",
      message: "stray failure",
    });
    child.emit("message", { type: "sent", requestId, msgId: "m1" });
    await expect(pending).resolves.toEqual({ msgId: "m1" });
  });

  test("rejects every in-flight send when the worker exits", async () => {
    const { child, proc } = await startedProcess();
    const first = proc.send({ pid: 42 }, "one");
    const second = proc.send({ pid: 42 }, "two");
    child.emitExit(0);
    await expect(first).rejects.toThrow(/exited before the send/);
    await expect(second).rejects.toThrow(AliasSendError);
  });

  test("throws before the worker has been started", async () => {
    const child = new FakeChild();
    const { process: proc } = makeForkedAliasProcess(child);
    await expect(proc.send({ pid: 42 }, "pong")).rejects.toThrow(
      AliasSendError,
    );
    expect(child.sent).toEqual([]);
  });

  test("throws once the worker has exited", async () => {
    const { child, proc } = await startedProcess();
    child.emitExit(0);
    await expect(proc.send({ pid: 42 }, "pong")).rejects.toThrow(
      "alias worker is not running",
    );
  });

  test("throws once the worker has been killed by a signal", async () => {
    const { child, proc } = await startedProcess();
    child.signalCode = "SIGKILL";
    await expect(proc.send({ pid: 42 }, "pong")).rejects.toThrow(
      AliasSendError,
    );
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
