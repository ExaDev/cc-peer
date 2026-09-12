import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { UdsTransport } from "./uds-transport.js";
import { FsKeyStore } from "./fs-key-store.js";
import { FsRegistryStore } from "./fs-registry-store.js";
import {
  keyFilePath,
  pidFromSocketPath,
  socketDirCandidates,
} from "./paths.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-test-"));
}

describe("UdsTransport", () => {
  test("connectWrite delivers lines to a listening socket", async () => {
    const home = await tempHome();
    const sockPath = join(home, "echo.sock");
    const received: string[] = [];
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          received.push(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(sockPath, () => {
        resolve();
      });
    });
    const transport = new UdsTransport();
    await transport.connectWrite(sockPath, [
      '{"type":"auth","token":"abc"}',
      '{"type":"user"}',
    ]);
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 250);
    });
    expect(received).toEqual([
      '{"type":"auth","token":"abc"}',
      '{"type":"user"}',
    ]);
    server.close();
    expect(await transport.probe(sockPath)).toBe(false);
  });

  test("probe reports a live socket true and a dead path false", async () => {
    const home = await tempHome();
    const live = join(home, "live.sock");
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(live, () => {
        resolve();
      });
    });
    const transport = new UdsTransport();
    expect(await transport.probe(live)).toBe(true);
    expect(await transport.probe(join(home, "missing.sock"))).toBe(false);
    server.close();
  });
});

describe("FsKeyStore", () => {
  test("round-trips a key file at the sha256-derived path", async () => {
    const home = await tempHome();
    const store = new FsKeyStore({ homeDir: home });
    const sockPath = `/tmp/cc-socks/4242.sock`;
    await store.writeForSocket(sockPath, {
      peerToken: "a".repeat(32),
      procStart: "Sat Sep 12 10:47:31 2026",
      pidDomain: "darwin",
    });
    const read = await store.readForSocket(sockPath);
    expect(read?.peerToken).toBe("a".repeat(32));
    const expectedPath = keyFilePath(sockPath, { homeDir: home });
    expect(expectedPath).toContain("4242.");
    await store.removeForSocket(sockPath);
    expect(await store.readForSocket(sockPath)).toBeUndefined();
  });
});

describe("FsRegistryStore", () => {
  test("round-trips a registry entry and skips malformed neighbours", async () => {
    const home = await tempHome();
    const store = new FsRegistryStore({ homeDir: home });
    const entry = {
      pid: 4242,
      sessionId: "sess-1",
      cwd: "/tmp",
      startedAt: 1,
      procStart: "Sat Sep 12 10:47:31 2026",
      version: "2.1.269",
      peerProtocol: 1,
      peerFeatures: ["notify_idle" as const],
      kind: "interactive" as const,
      entrypoint: "cli",
      pidDomain: "darwin",
      messagingSocketPath: "/tmp/cc-socks/4242.sock",
      name: "cc-peer-test",
      nameSource: "user" as const,
      nameSince: 1,
      updatedAt: 1,
      status: "busy" as const,
      statusUpdatedAt: 1,
    };
    await store.write(entry);
    await mkdir(join(home, ".claude", "sessions"), { recursive: true });
    await writeFile(join(home, ".claude", "sessions", "777.json"), "not json");
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("cc-peer-test");
    expect(await store.read(4242)).toBeDefined();
    expect(await store.read(777)).toBeUndefined();
    await store.touch(4242);
    const touched = await store.read(4242);
    expect(touched?.updatedAt).toBeGreaterThan(1);
    await store.remove(4242);
    expect(await store.read(4242)).toBeUndefined();
  });
});

describe("paths", () => {
  test("derives pid from socket path and lists candidate dirs", () => {
    expect(pidFromSocketPath("/tmp/cc-socks/4242.sock")).toBe(4242);
    expect(socketDirCandidates({ socketDir: "/custom" })).toEqual(["/custom"]);
    expect(socketDirCandidates()[0]).toBe("/tmp/cc-socks");
  });
});
