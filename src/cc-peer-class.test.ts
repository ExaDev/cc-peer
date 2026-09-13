import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import { once } from "node:events";

import { CcPeer } from "./cc-peer.js";
import { UdsTransport, SystemClock } from "./adapters/node/uds-transport.js";
import { FsKeyStore } from "./adapters/node/fs-key-store.js";
import { FsRegistryStore } from "./adapters/node/fs-registry-store.js";
import { socketPathForPid } from "./adapters/node/paths.js";
import {
  MessageTooLargeError,
  NoLiveInboxError,
  NotStartedError,
  UnknownPeerError,
} from "./errors.js";
import { newMsgId } from "./domain/ids.js";

/** Frames exceeding the receiver line cap are refused before the wire. */
const MAX_FRAME_CHARS = 120_000;
/** Default pacer capacity: the 31st rapid send waits for a refill. */
const PACER_CAPACITY = 30;

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-class-"));
}

function peerOptions(home: string, name?: string, sessionId?: string) {
  return {
    homeDir: home,
    socketDir: join(home, "socks"),
    ...(name !== undefined ? { name } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

function makePeer(
  home: string,
  overrides: Readonly<{
    name?: string;
    sessionId?: string;
    heartbeatMs?: number;
    lstart?: (pid: number) => Promise<string | undefined>;
    logger?: (message: string) => void;
  }> = {},
): CcPeer {
  return new CcPeer(
    {
      ...peerOptions(home, overrides.name, overrides.sessionId),
      ...(overrides.heartbeatMs !== undefined
        ? { heartbeatMs: overrides.heartbeatMs }
        : {}),
      ...(overrides.logger !== undefined ? { logger: overrides.logger } : {}),
    },
    {
      transport: new UdsTransport(),
      registry: new FsRegistryStore({ homeDir: home }),
      keys: new FsKeyStore({ homeDir: home }),
      procInfo: {
        alive: async () => Promise.resolve(true),
        lstart:
          overrides.lstart ??
          (async () =>
            Promise.resolve("Sat Sep 12 10:47:31 2026" satisfies string)),
      },
      clock: new SystemClock(),
    },
  );
}

/**
 * Connect a raw client that speaks the wire protocol to the peer's socket. `socketPath` defaults to recomputing it from the peer's own options, which only matches the path the peer actually bound when the ambient platform at call time is the same one it started under — true for every caller except a test that wraps this call in withPlatform("win32", ...) to exercise a server-side isWindows() branch while the peer itself started, and is genuinely listening, on the real (POSIX) test platform. Those callers must pass the real socketPath explicitly, computed before entering the mock.
 */
async function rawClient(peer: CcPeer, socketPath?: string): Promise<Socket> {
  const path =
    socketPath ?? socketPathForPid(process.pid, peerOptions(tempHomeOf(peer)));
  const socket = connect(path);
  await once(socket, "connect");
  return socket;
}

const tempHomeCache = new Map<CcPeer, string>();

function tempHomeOf(peer: CcPeer): string {
  return tempHomeCache.get(peer) ?? "";
}

/**
 * Runs fn with process.platform reporting the given value, always restoring the real value afterward even if fn throws. process.platform's own property descriptor is configurable, so this is a standard way to exercise a platform branch without a real machine of that platform — the isWindows()-gated branches this covers only ever read process.platform, they don't depend on the kernel actually being that OS.
 */
async function withPlatform<T>(
  value: NodeJS.Platform,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", {
      value: original,
      configurable: true,
    });
  }
}

describe("CcPeer dependency-injected construction", () => {
  test("the registry entry's pidDomain reflects the real runtime platform", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const store = new FsRegistryStore({ homeDir: home });
    const entry = await store.read(process.pid);
    expect(entry?.pidDomain).toBe(process.platform);
    await peer.stop();
  });

  test("on Windows, start() does not create a socket directory (a named pipe has none of its own)", async () => {
    const home = await tempHome();
    // A fake transport stands in for the real UdsTransport: under a mocked win32 platform, socketPathForPid returns a named-pipe-shaped string, which a real POSIX kernel would just as happily bind as a literal (garbage) relative filename in the working directory — that would prove nothing about mkdir being skipped and would litter the test run with a stray file. Asserting directly on socketPath's shape and on the directory's absence is what this test actually means to check.
    let listenedPath: string | undefined;
    const peer = new CcPeer(peerOptions(home), {
      transport: {
        listen: async (path) => {
          listenedPath = path;
          return Promise.resolve({
            socketPath: path,
            close: async () => Promise.resolve(),
          });
        },
        connectWrite: async () => Promise.resolve(),
        probe: async () => Promise.resolve(false),
      },
      registry: new FsRegistryStore({ homeDir: home }),
      keys: new FsKeyStore({ homeDir: home }),
      procInfo: {
        alive: async () => Promise.resolve(true),
        lstart: async () => Promise.resolve("Sat Sep 12 10:47:31 2026"),
      },
      clock: new SystemClock(),
    });
    await withPlatform("win32", async () => peer.start());
    expect(listenedPath?.startsWith("\\\\.\\pipe\\")).toBe(true);
    await expect(stat(join(home, "socks"))).rejects.toThrow();
    await peer.stop();
  });

  test("start throws NotStartedError when procStart is unreadable", async () => {
    const home = await tempHome();
    const peer = makePeer(home, {
      lstart: async () => Promise.resolve(undefined),
    });
    await expect(peer.start()).rejects.toThrow(NotStartedError);
  });

  test("send and subscribeIdle before start throw NotStartedError", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await expect(peer.send({ pid: 1 }, "x")).rejects.toThrow(NotStartedError);
    await expect(peer.subscribeIdle({ pid: 1 })).rejects.toThrow(
      NotStartedError,
    );
    // roster() on a not-yet-listening peer omits the own-socket exclusion.
    expect(await peer.roster()).toEqual([]);
  });

  test("after stop, send and subscribeIdle throw and stop is idempotent", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    await peer.stop();
    await expect(peer.send({ pid: 1 }, "x")).rejects.toThrow(NotStartedError);
    await expect(peer.subscribeIdle({ pid: 1 })).rejects.toThrow(
      NotStartedError,
    );
    await expect(peer.stop()).resolves.toBeUndefined();
  });

  test("stop on a never-started peer is a harmless no-op", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await expect(peer.stop()).resolves.toBeUndefined();
  });

  test("the heartbeat touches the registry on interval", async () => {
    const home = await tempHome();
    const peer = makePeer(home, { heartbeatMs: 20 });
    await peer.start();
    const store = new FsRegistryStore({ homeDir: home });
    const before = (await store.read(process.pid))?.updatedAt;
    expect(before).toBeDefined();
    // Polls for the first tick rather than sleeping a fixed multiple of heartbeatMs and checking once: a real setInterval has no delivery guarantee under a busy scheduler, so a single fixed wait is a race against however loaded the runner happens to be at that moment, whereas polling only needs one tick to ever land within the overall timeout, however late the runner makes it.
    const deadline = Date.now() + 5_000;
    let after: number | undefined;
    do {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20);
        timer.unref();
      });
      after = (await store.read(process.pid))?.updatedAt;
    } while (
      (after === undefined || after <= (before ?? 0)) &&
      Date.now() < deadline
    );
    expect(after !== undefined && before !== undefined && after > before).toBe(
      true,
    );
    await peer.stop();
  }, 10_000);

  test("a heartbeat tick that fails to touch the registry is swallowed", async () => {
    const home = await tempHome();
    const failingRegistry = {
      list: async () => Promise.resolve([]),
      read: async () => Promise.resolve(undefined),
      write: async () => Promise.resolve(undefined),
      touch: async () => Promise.reject(new Error("registry unavailable")),
      remove: async () => Promise.resolve(undefined),
    };
    const peer = new CcPeer(
      { homeDir: home, socketDir: join(home, "socks"), heartbeatMs: 20 },
      {
        transport: new UdsTransport(),
        registry: failingRegistry,
        keys: new FsKeyStore({ homeDir: home }),
        procInfo: {
          alive: async () => Promise.resolve(true),
          lstart: async () => Promise.resolve("Sat Sep 12 10:47:31 2026"),
        },
        clock: new SystemClock(),
      },
    );
    await peer.start();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 60);
      timer.unref();
    });
    // The heartbeat's own rejection never surfaces as an unhandled rejection or thrown error; reaching this line at all is the assertion.
    await peer.stop();
  });

  test("create without a logger starts cleanly (sink log path)", async () => {
    const home = await tempHome();
    const peer = await CcPeer.create(peerOptions(home));
    expect(await peer.roster()).toEqual([]);
    await peer.stop();
  });

  test("on Windows, create() selects WinProcInfo, whose PowerShell probe fails on a non-Windows test runner", async () => {
    // This distinguishes the two branches by their genuinely different behaviour rather than by inspecting private state: ps exists on this runner and would succeed if PsProcInfo were selected instead, so this rejection only happens when WinProcInfo (backed by a real powershell.exe this machine does not have) is the one actually chosen.
    const home = await tempHome();
    await expect(
      withPlatform("win32", async () => CcPeer.create(peerOptions(home))),
    ).rejects.toThrow(NotStartedError);
  });

  test("start logs unnamed when no name is given", async () => {
    const home = await tempHome();
    const messages: string[] = [];
    const peer = makePeer(home, {
      logger: (m) => {
        messages.push(m);
      },
    });
    await peer.start();
    expect(messages.some((m) => m.includes("unnamed"))).toBe(true);
    await peer.stop();
  });

  test("start logs the given name", async () => {
    const home = await tempHome();
    const messages: string[] = [];
    const peer = makePeer(home, {
      name: "named-peer",
      logger: (m) => {
        messages.push(m);
      },
    });
    await peer.start();
    expect(messages.some((m) => m.includes("named-peer"))).toBe(true);
    await peer.stop();
  });
});

describe("CcPeer send error paths", () => {
  test("subscribeIdle to a keyed target sends the control frame and returns its id", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const frames: string[] = [];
    const transport = new UdsTransport();
    const targetPath = join(home, "idle-target.sock");
    const listener = await transport.listen(targetPath, (conn) => {
      void (async () => {
        for await (const line of conn.readLines()) {
          frames.push(line);
        }
      })();
    });
    const keys = new FsKeyStore({ homeDir: home });
    await keys.writeForSocket(targetPath, {
      peerToken: "e".repeat(32),
      procStart: "Sat Sep 12 10:47:31 2026",
      pidDomain: "darwin",
    });
    const { msgId } = await peer.subscribeIdle({ address: targetPath });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 400);
      timer.unref();
    });
    expect(frames).toHaveLength(2);
    expect(frames[1]).toContain("notify_when_idle");
    expect(frames[1]).toContain(msgId);
    await listener.close();
    await peer.stop();
  });

  test("NoLiveInboxError for a keyed listener with no published key", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const keylessPath = join(home, "keyless.sock");
    const transport = new UdsTransport();
    const listener = await transport.listen(keylessPath, () => {
      void 0;
    });
    await expect(peer.send({ address: keylessPath }, "x")).rejects.toThrow(
      NoLiveInboxError,
    );
    await expect(peer.subscribeIdle({ address: keylessPath })).rejects.toThrow(
      NoLiveInboxError,
    );
    await listener.close();
    await peer.stop();
  });

  test("UnknownPeerError for an unregistered name", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    await expect(peer.send({ name: "ghost" }, "x")).rejects.toThrow(
      UnknownPeerError,
    );
    await peer.stop();
  });

  test("MessageTooLargeError for an oversized body", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const target = await keyedTarget(home);
    await expect(
      peer.send({ address: target }, "x".repeat(MAX_FRAME_CHARS)),
    ).rejects.toThrow(MessageTooLargeError);
    await peer.stop();
  });
});

const targetsToClose: { close: () => Promise<void> }[] = [];

/** Create a listening socket with a published key and return its path. */
async function keyedTarget(home: string): Promise<string> {
  const transport = new UdsTransport();
  const keys = new FsKeyStore({ homeDir: home });
  const targetPath = join(home, "target.sock");
  const listener = await transport.listen(targetPath, () => {
    void 0;
  });
  await keys.writeForSocket(targetPath, {
    peerToken: "c".repeat(32),
    procStart: "Sat Sep 12 10:47:31 2026",
    pidDomain: "darwin",
  });
  targetsToClose.push(listener);
  return targetPath;
}

describe("CcPeer send happy paths by pid and address", () => {
  test("send by pid resolves the socket path through the configured dir", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const keys = new FsKeyStore({ homeDir: home });
    // A target pid distinct from our own so the resolved socket path does
    // not collide with the sender's own listening socket.
    const TARGET_PID = 88001;
    const pidPath = socketPathForPid(TARGET_PID, {
      socketDir: join(home, "socks"),
    });
    await mkdir(join(home, "socks"), { recursive: true });
    const transport = new UdsTransport();
    const listener = await transport.listen(pidPath, () => {
      void 0;
    });
    await keys.writeForSocket(pidPath, {
      peerToken: "d".repeat(32),
      procStart: "Sat Sep 12 10:47:31 2026",
      pidDomain: "darwin",
    });
    const sent = await peer.send({ pid: TARGET_PID }, "by pid");
    expect(sent.msgId).toMatch(/^[0-9a-f-]{36}$/);
    await listener.close();
    await peer.stop();
  });

  test("send by raw address with and without the uds: scheme", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const target = await keyedTarget(home);
    await expect(peer.send({ address: target }, "bare")).resolves.toBeDefined();
    await expect(
      peer.send({ address: `uds:${target}` }, "prefixed"),
    ).resolves.toBeDefined();
    await peer.stop();
  });

  test("send options populate envelope attributes and frame fields", async () => {
    const home = await tempHome();
    const deps = () => ({
      transport: new UdsTransport(),
      registry: new FsRegistryStore({ homeDir: home }),
      keys: new FsKeyStore({ homeDir: home }),
      procInfo: {
        alive: async () => Promise.resolve(true),
        lstart: async () => Promise.resolve("Sat Sep 12 10:47:31 2026"),
      },
      clock: new SystemClock(),
    });
    const sender = new CcPeer(
      {
        homeDir: home,
        socketDir: join(home, "socks-s"),
        name: "opt-sender",
      },
      deps(),
    );
    await sender.start();
    const receiver = new CcPeer(
      {
        homeDir: home,
        socketDir: join(home, "socks-r"),
        name: "opt-receiver",
        sessionId: "sess-opt",
      },
      deps(),
    );
    await receiver.start();
    const messages: unknown[] = [];
    receiver.on("message", (m) => {
      messages.push(m);
    });
    // Both peers share one pid, so the single registry file holds whichever
    // peer started last: the receiver, which is exactly what the sender's
    // name resolution needs to find.
    await sender.send({ name: "opt-receiver" }, "attested default");
    await sender.send({ name: "opt-receiver" }, "prompting", {
      fromMode: "prompting",
      priority: "later",
      sessionId: "sess-opt",
    });
    await sender.send({ name: "opt-receiver" }, "unattested", {
      fromMode: false,
    });
    await waitFor(() => messages.length >= 3);
    const first = messages[0] as { fromName?: string; fromMode?: string };
    const second = messages[1] as {
      fromMode?: string;
      fromSession?: string;
      msgId: string;
    };
    const third = messages[2] as { fromMode?: string };
    expect(first.fromName).toBe("opt-sender");
    expect(first.fromMode).toBe("bypass");
    expect(second.fromMode).toBe("prompting");
    expect(second.fromSession).toBe("sess-opt");
    expect(third.fromMode).toBeUndefined();
    expect(second.msgId).toMatch(/^[0-9a-f-]{36}$/);
    await sender.stop();
    await receiver.stop();
  });

  test("the pacer waits for a refill on the capacity-exceeding send", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    const target = await keyedTarget(home);
    const started = Date.now();
    // Concurrent sends exhaust the bucket faster than the 0.5/s refill can
    // top it up (serial sends each pay connectWrite's 150ms linger, letting
    // the refill mask the exhaustion).
    await Promise.all(
      Array.from({ length: PACER_CAPACITY + 1 }, async (_, i) =>
        peer.send({ address: target }, "burst " + i.toString()),
      ),
    );
    // The capacity-exceeding send waited roughly one refill period (2s at 0.5/s).
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    await peer.stop();
  }, 15_000);
});

describe("CcPeer inbound handling", () => {
  test("a foreign auth token logs a mismatch but frames still process", async () => {
    const home = await tempHome();
    const logs: string[] = [];
    const peer = makePeer(home, {
      logger: (m) => {
        logs.push(m);
      },
    });
    await peer.start();
    tempHomeCache.set(peer, home);
    const messages: unknown[] = [];
    peer.on("message", (m) => {
      messages.push(m);
    });
    const socket = await rawClient(peer);
    socket.write('{"type":"auth","token":"' + "0".repeat(32) + '"}\n');
    const envelope =
      '<cross-session-message from="uds:/tmp/cc-socks/9.sock" hop-chain="' +
      "1".repeat(24) +
      '" from-name="hopper">\nhi\n</cross-session-message>';
    socket.write(
      '{"msgV":1,"msg_id":"' +
        newMsgId() +
        '","type":"user","message":{"role":"user","content":' +
        JSON.stringify(envelope) +
        '},"priority":"next","from":"uds:/tmp/cc-socks/9.sock"}\n',
    );
    await waitFor(() => messages.length > 0);
    expect(logs.some((m) => m.includes("foreign token tolerated"))).toBe(true);
    const message = messages[0] as {
      hopChain?: string[];
      fromName?: string;
      from?: string;
    };
    expect(message.hopChain).toEqual(["1".repeat(24)]);
    expect(message.fromName).toBe("hopper");
    expect(message.from).toBe("uds:/tmp/cc-socks/9.sock");
    socket.destroy();
    await peer.stop();
  });

  test("on Windows, a missing or mismatched auth line closes the connection without delivering anything", async () => {
    const home = await tempHome();
    const logs: string[] = [];
    const peer = makePeer(home, {
      logger: (m) => {
        logs.push(m);
      },
    });
    await peer.start();
    tempHomeCache.set(peer, home);
    // Computed under the real (POSIX) test platform, before the mock below: this is the path the peer actually bound, which withPlatform("win32", ...) below must not be allowed to recompute out from under it.
    const socketPath = socketPathForPid(process.pid, {
      socketDir: join(home, "socks"),
    });
    const messages: unknown[] = [];
    peer.on("message", (m) => {
      messages.push(m);
    });
    await withPlatform("win32", async () => {
      const socket = await rawClient(peer, socketPath);
      socket.write('{"type":"auth","token":"' + "0".repeat(32) + '"}\n');
      const envelope =
        '<cross-session-message from="uds:/tmp/cc-socks/9.sock">\nhi\n</cross-session-message>';
      socket.write(
        '{"msgV":1,"msg_id":"' +
          newMsgId() +
          '","type":"user","message":{"role":"user","content":' +
          JSON.stringify(envelope) +
          '},"priority":"next","from":"uds:/tmp/cc-socks/9.sock"}\n',
      );
      await once(socket, "close");
    });
    expect(
      logs.some((m) => m.includes("auth line missing or mismatched")),
    ).toBe(true);
    expect(messages).toHaveLength(0);
    await peer.stop();
  });

  test("on Windows, a valid matching auth line still delivers the frame", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    tempHomeCache.set(peer, home);
    const keyStore = new FsKeyStore({ homeDir: home });
    const socketPath = socketPathForPid(process.pid, {
      socketDir: join(home, "socks"),
    });
    const token = (await keyStore.readForSocket(socketPath))?.peerToken ?? "";
    const messages: unknown[] = [];
    peer.on("message", (m) => {
      messages.push(m);
    });
    await withPlatform("win32", async () => {
      const socket = await rawClient(peer, socketPath);
      socket.write('{"type":"auth","token":"' + token + '"}\n');
      const envelope =
        '<cross-session-message from="uds:/tmp/cc-socks/9.sock">\nhi\n</cross-session-message>';
      socket.write(
        '{"msgV":1,"msg_id":"' +
          newMsgId() +
          '","type":"user","message":{"role":"user","content":' +
          JSON.stringify(envelope) +
          '},"priority":"next","from":"uds:/tmp/cc-socks/9.sock"}\n',
      );
      await waitFor(() => messages.length > 0);
      socket.destroy();
    });
    expect(messages).toHaveLength(1);
    await peer.stop();
  });

  test("malformed JSON lines are skipped and later frames still emit", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    tempHomeCache.set(peer, home);
    const messages: unknown[] = [];
    peer.on("message", (m) => {
      messages.push(m);
    });
    const socket = await rawClient(peer);
    const keyStore = new FsKeyStore({ homeDir: home });
    const socketPath = socketPathForPid(process.pid, {
      socketDir: join(home, "socks"),
    });
    const token = (await keyStore.readForSocket(socketPath))?.peerToken ?? "";
    socket.write('{"type":"auth","token":"' + token + '"}\n');
    socket.write("this is not json\n");
    // Valid JSON that matches no wire frame shape at all: rejected by WireFrameSchema and skipped, distinct from the "not json" case above.
    socket.write('{"totally":"unrelated","shape":true}\n');
    socket.write(
      '{"msgV":1,"msg_id":"' +
        newMsgId() +
        '","type":"user","message":{"role":"user","content":"plain body no envelope"},"priority":"next","from":"uds:/tmp/cc-socks/9.sock"}\n',
    );
    await waitFor(() => messages.length > 0);
    const message = messages[0] as { body: string; fromName?: string };
    expect(message.body).toBe("plain body no envelope");
    expect(message.fromName).toBeUndefined();
    socket.destroy();
    await peer.stop();
  });

  test("receipt and idle notice control frames emit their events", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    tempHomeCache.set(peer, home);
    const receipts: unknown[] = [];
    const idles: unknown[] = [];
    peer.on("receipt", (r) => {
      receipts.push(r);
    });
    peer.on("idle", (n) => {
      idles.push(n);
    });
    const socket = await rawClient(peer);
    socket.write('{"type":"auth","token":"' + "0".repeat(32) + '"}\n');
    socket.write(
      '{"type":"control","action":"peer_message_status","status":"held","reason":"r","from":"uds:/tmp/cc-socks/9.sock","orig_msg_id":"m1","msgV":1,"msg_id":"m2"}\n',
    );
    socket.write(
      '{"type":"control","action":"peer_idle_notice","orig_msg_id":"m1","state":"idle","finished_at":1,"from":"uds:/tmp/cc-socks/9.sock","msgV":1,"msg_id":"m3"}\n',
    );
    await waitFor(() => receipts.length > 0 && idles.length > 0);
    socket.destroy();
    await peer.stop();
  });

  test("an unknown control action emits nothing", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    tempHomeCache.set(peer, home);
    const events: string[] = [];
    peer.on("message", () => {
      events.push("message");
    });
    peer.on("receipt", () => {
      events.push("receipt");
    });
    peer.on("idle", () => {
      events.push("idle");
    });
    const socket = await rawClient(peer);
    socket.write('{"type":"auth","token":"' + "0".repeat(32) + '"}\n');
    socket.write(
      '{"type":"control","action":"notify_when_idle","from":"uds:/tmp/cc-socks/9.sock","from_mode":"bypass","msgV":1,"msg_id":"m4"}\n',
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 400);
      timer.unref();
    });
    expect(events).toEqual([]);
    socket.destroy();
    await peer.stop();
  });

  test("a connection closed before any line is harmless", async () => {
    const home = await tempHome();
    const peer = makePeer(home);
    await peer.start();
    tempHomeCache.set(peer, home);
    const socket = await rawClient(peer);
    socket.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 300);
      timer.unref();
    });
    await peer.stop();
  });
});

/** Poll until the predicate holds, bounded to avoid hanging tests. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i += 1) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 50);
      timer.unref();
    });
  }
  expect(predicate()).toBe(true);
}

test.afterAll(async () => {
  for (const target of targetsToClose) {
    await target.close();
  }
});
