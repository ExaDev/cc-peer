import { describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";

import { AliasPool, workerExtensionFor } from "./alias-pool.js";
import { AliasSendError } from "./errors.js";
import type { AliasProcess } from "./ports/alias-process.js";
import type { PeerRef } from "./cc-peer.js";

describe("workerExtensionFor", () => {
  test("returns .cjs for a module URL ending in .cjs", () => {
    expect(workerExtensionFor("file:///dist/alias-pool.cjs")).toBe(".cjs");
  });

  test("returns .mjs for a module URL ending in .mjs", () => {
    expect(workerExtensionFor("file:///dist/alias-pool.mjs")).toBe(".mjs");
  });

  test("returns .mjs for any other extension (e.g. the .ts source in dev/test)", () => {
    expect(workerExtensionFor("file:///src/alias-pool.ts")).toBe(".mjs");
  });
});

/** A fake AliasProcess whose start()/stop() are externally controllable, so tests can assert ordering and concurrency without a real child process. */
class FakeAliasProcess implements AliasProcess {
  readonly events = new EventEmitter();
  startCalls: unknown[] = [];
  sendCalls: { target: Readonly<PeerRef>; body: string }[] = [];
  stopCalls = 0;
  private resolveStart: (() => void) | undefined;
  private rejectStart: ((error: Error) => void) | undefined;
  private resolveSend:
    ((result: Readonly<{ msgId: string }>) => void) | undefined;
  private rejectSend: ((error: Error) => void) | undefined;

  async start(options: unknown): Promise<void> {
    this.startCalls.push(options);
    return new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  async send(
    target: Readonly<PeerRef>,
    body: string,
  ): Promise<{ msgId: string }> {
    this.sendCalls.push({ target, body });
    return new Promise<{ msgId: string }>((resolve, reject) => {
      this.resolveSend = resolve;
      this.rejectSend = reject;
    });
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    return Promise.resolve();
  }

  finishStart(): void {
    this.resolveStart?.();
  }

  failStart(error: Error): void {
    this.rejectStart?.(error);
  }

  finishSend(msgId: string): void {
    this.resolveSend?.({ msgId });
  }

  failSend(error: Error): void {
    this.rejectSend?.(error);
  }
}

function makePool(procs: readonly FakeAliasProcess[]): {
  pool: AliasPool;
  spawnCount: () => number;
} {
  let index = 0;
  const spawn = vi.fn(() => {
    const proc = procs[index];
    index += 1;
    if (proc === undefined) {
      throw new Error("makePool: not enough fake processes provided");
    }
    return proc;
  });
  return {
    pool: new AliasPool({ spawn }),
    spawnCount: () => spawn.mock.calls.length,
  };
}

describe("AliasPool.ensure", () => {
  test("spawns a process and passes the alias name through to start()", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    expect(proc.startCalls).toEqual([{ name: "alice" }]);
    expect(pool.activeAliases()).toEqual(["alice"]);
  });

  test("passes pool-level homeDir/socketDir through to start()", async () => {
    const proc = new FakeAliasProcess();
    let index = 0;
    const spawn = vi.fn(() => {
      index += 1;
      return proc;
    });
    const pool = new AliasPool(
      { spawn },
      { homeDir: "/tmp/home", socketDir: "/tmp/socks" },
    );
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    expect(index).toBe(1);
    expect(proc.startCalls).toEqual([
      { name: "alice", homeDir: "/tmp/home", socketDir: "/tmp/socks" },
    ]);
  });

  test("a second ensure() for an already-active alias is a no-op", async () => {
    const proc = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([proc]);
    const first = pool.ensure("alice");
    proc.finishStart();
    await first;
    await pool.ensure("alice");
    expect(spawnCount()).toBe(1);
  });

  test("concurrent ensure() calls for the same name spawn only once", async () => {
    const proc = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([proc]);
    const first = pool.ensure("alice");
    const second = pool.ensure("alice");
    proc.finishStart();
    await Promise.all([first, second]);
    expect(spawnCount()).toBe(1);
    expect(pool.activeAliases()).toEqual(["alice"]);
  });

  test("ensure() for two different names spawns two processes", async () => {
    const alice = new FakeAliasProcess();
    const bob = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([alice, bob]);
    const pending = Promise.all([pool.ensure("alice"), pool.ensure("bob")]);
    alice.finishStart();
    bob.finishStart();
    await pending;
    expect(spawnCount()).toBe(2);
    expect(pool.activeAliases().sort()).toEqual(["alice", "bob"]);
  });

  test("a failed start() rejects ensure() and leaves the alias inactive", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.ensure("alice");
    proc.failStart(new Error("boom"));
    await expect(pending).rejects.toThrow("boom");
    expect(pool.activeAliases()).toEqual([]);
  });

  test("ensure() can be retried after a failed start()", async () => {
    const failing = new FakeAliasProcess();
    const retry = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([failing, retry]);
    const firstAttempt = pool.ensure("alice");
    failing.failStart(new Error("boom"));
    await expect(firstAttempt).rejects.toThrow("boom");
    const secondAttempt = pool.ensure("alice");
    retry.finishStart();
    await secondAttempt;
    expect(spawnCount()).toBe(2);
    expect(pool.activeAliases()).toEqual(["alice"]);
  });
});

describe("AliasPool message and exit relay", () => {
  test("relays a process's message event with the alias name attached", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    const received: unknown[] = [];
    pool.on("message", (m: unknown) => {
      received.push(m);
    });
    proc.events.emit("message", { body: "hi", msgId: "m1" });
    expect(received).toEqual([{ alias: "alice", body: "hi", msgId: "m1" }]);
  });

  test("an unexpected process exit removes the alias and emits a pool exit event", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    const exits: unknown[] = [];
    pool.on("exit", (e: unknown) => {
      exits.push(e);
    });
    proc.events.emit("exit");
    expect(exits).toEqual([{ alias: "alice" }]);
    expect(pool.activeAliases()).toEqual([]);
  });
});

describe("AliasPool.send", () => {
  test("starts the alias on demand and sends from it, resolving with the message id", async () => {
    const proc = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([proc]);
    const pending = pool.send("alice", { pid: 42 }, "pong");
    proc.finishStart();
    await vi.waitFor(() => {
      expect(proc.sendCalls).toHaveLength(1);
    });
    proc.finishSend("m1");
    await expect(pending).resolves.toEqual({ msgId: "m1" });
    expect(proc.sendCalls).toEqual([{ target: { pid: 42 }, body: "pong" }]);
    expect(spawnCount()).toBe(1);
    expect(pool.activeAliases()).toEqual(["alice"]);
  });

  test("reuses an already-active alias rather than spawning a second process", async () => {
    const proc = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([proc]);
    const ensuring = pool.ensure("alice");
    proc.finishStart();
    await ensuring;
    const pending = pool.send("alice", { name: "bob" }, "pong");
    await vi.waitFor(() => {
      expect(proc.sendCalls).toHaveLength(1);
    });
    proc.finishSend("m2");
    await expect(pending).resolves.toEqual({ msgId: "m2" });
    expect(spawnCount()).toBe(1);
  });

  test("waits for an in-flight ensure() of the same name instead of spawning again", async () => {
    const proc = new FakeAliasProcess();
    const { pool, spawnCount } = makePool([proc]);
    const ensuring = pool.ensure("alice");
    const pending = pool.send("alice", { address: "uds:/tmp/9.sock" }, "pong");
    proc.finishStart();
    await ensuring;
    await vi.waitFor(() => {
      expect(proc.sendCalls).toHaveLength(1);
    });
    proc.finishSend("m3");
    await expect(pending).resolves.toEqual({ msgId: "m3" });
    expect(spawnCount()).toBe(1);
  });

  test("rejects when the alias cannot be started", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.send("alice", { pid: 42 }, "pong");
    proc.failStart(new Error("boom"));
    await expect(pending).rejects.toThrow("boom");
    expect(proc.sendCalls).toEqual([]);
    expect(pool.activeAliases()).toEqual([]);
  });

  test("propagates the alias process's own send failure", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.send("alice", { pid: 42 }, "pong");
    proc.finishStart();
    await vi.waitFor(() => {
      expect(proc.sendCalls).toHaveLength(1);
    });
    proc.failSend(new AliasSendError("NO_LIVE_INBOX: no auth key published"));
    await expect(pending).rejects.toThrow(AliasSendError);
    await expect(pending).rejects.toThrow(/no auth key published/);
  });
});

describe("AliasPool.retire", () => {
  test("stops an active alias and removes it", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    await pool.retire("alice");
    expect(proc.stopCalls).toBe(1);
    expect(pool.activeAliases()).toEqual([]);
  });

  test("retiring an unknown alias is a harmless no-op", async () => {
    const { pool } = makePool([]);
    await expect(pool.retire("ghost")).resolves.toBeUndefined();
  });

  test("retire waits for an in-flight ensure() and then stops it", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const ensurePromise = pool.ensure("alice");
    const retirePromise = pool.retire("alice");
    proc.finishStart();
    await ensurePromise;
    await retirePromise;
    expect(proc.stopCalls).toBe(1);
    expect(pool.activeAliases()).toEqual([]);
  });

  test("retire waits for an in-flight ensure() that fails without throwing", async () => {
    const proc = new FakeAliasProcess();
    const { pool } = makePool([proc]);
    const ensurePromise = pool.ensure("alice");
    const retirePromise = pool.retire("alice");
    proc.failStart(new Error("boom"));
    await expect(ensurePromise).rejects.toThrow("boom");
    await expect(retirePromise).resolves.toBeUndefined();
    expect(proc.stopCalls).toBe(0);
  });
});

describe("AliasPool.stopAll", () => {
  test("retires every active alias", async () => {
    const alice = new FakeAliasProcess();
    const bob = new FakeAliasProcess();
    const { pool } = makePool([alice, bob]);
    const pending = Promise.all([pool.ensure("alice"), pool.ensure("bob")]);
    alice.finishStart();
    bob.finishStart();
    await pending;
    await pool.stopAll();
    expect(alice.stopCalls).toBe(1);
    expect(bob.stopCalls).toBe(1);
    expect(pool.activeAliases()).toEqual([]);
  });

  test("on an empty pool is a harmless no-op", async () => {
    const { pool } = makePool([]);
    await expect(pool.stopAll()).resolves.toBeUndefined();
  });
});

describe("AliasPool logging", () => {
  test("logs when an alias becomes active and when it is retired", async () => {
    const proc = new FakeAliasProcess();
    const spawn = vi.fn(() => proc);
    const messages: string[] = [];
    const pool = new AliasPool(
      { spawn },
      {
        logger: (m) => {
          messages.push(m);
        },
      },
    );
    const pending = pool.ensure("alice");
    proc.finishStart();
    await pending;
    await pool.retire("alice");
    expect(
      messages.some((m) => m.includes("alice") && m.includes("active")),
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("alice") && m.includes("retired")),
    ).toBe(true);
  });

  test("create() without a logger starts cleanly (sink log path)", async () => {
    const proc = new FakeAliasProcess();
    const spawn = vi.fn(() => proc);
    const pool = new AliasPool({ spawn });
    const pending = pool.ensure("alice");
    proc.finishStart();
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("AliasPool.create", () => {
  test("returns a pool with no active aliases and no logger required", () => {
    const pool = AliasPool.create();
    expect(pool.activeAliases()).toEqual([]);
  });
});
