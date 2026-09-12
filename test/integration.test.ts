import { describe, expect, test } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CcPeer } from "../src/cc-peer.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-it-"));
}

/**
 * Two peers in one process share a pid, and the protocol derives socket paths from pids, so each peer gets its own socket directory under a shared HOME - distinct sockets, shared registry.
 */
function peerOptions(home: string, name: string, suffix: string) {
  return {
    homeDir: home,
    socketDir: join(home, `socks-${suffix}`),
    name,
    sessionId: `session-${suffix}`,
    logger: () => {
      void 0;
    },
  };
}

describe("CcPeer integration", () => {
  test("two peers discover each other and exchange a message", async () => {
    const home = await tempHome();
    const alice = await CcPeer.create(peerOptions(home, "alice", "a"));
    const bob = await CcPeer.create(peerOptions(home, "bob", "b"));
    const received: string[] = [];
    bob.on("message", (m: Readonly<{ body: string }>) => {
      received.push(m.body);
    });
    const rosterOnAlice = await alice.roster();
    const bobEntry = rosterOnAlice.find((e) => e.name === "bob");
    expect(bobEntry).toBeDefined();
    const { msgId } = await alice.send({ name: "bob" }, "hello from alice");
    expect(msgId).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 2_000);
      timer.unref();
    });
    expect(received).toEqual(["hello from alice"]);
    await alice.stop();
    await bob.stop();
  }, 15_000);

  test("roster excludes own entry and dead sockets", async () => {
    const home = await tempHome();
    const solo = await CcPeer.create(peerOptions(home, "solo", "s"));
    const roster = await solo.roster();
    expect(roster.find((e) => e.name === "solo")).toBeUndefined();
    await solo.stop();
    const afterStop = await solo.roster();
    expect(afterStop.find((e) => e.name === "solo")).toBeUndefined();
  }, 10_000);

  test("stop removes registry and key artifacts", async () => {
    const home = await tempHome();
    const peer = await CcPeer.create(peerOptions(home, "ephemeral", "e"));
    const registry = await readFile(
      join(home, ".claude", "sessions", `${process.pid.toString()}.json`),
      "utf8",
    );
    expect(registry).toContain("ephemeral");
    await peer.stop();
    await expect(
      readFile(
        join(home, ".claude", "sessions", `${process.pid.toString()}.json`),
      ),
    ).rejects.toThrow();
  }, 10_000);
});
