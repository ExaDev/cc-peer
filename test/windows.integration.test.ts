import { describe, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { once } from "node:events";

import { CcPeer } from "../src/cc-peer.js";
import { socketPathForPid } from "../src/adapters/node/paths.js";
import { FsKeyStore } from "../src/adapters/node/fs-key-store.js";
import { REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS } from "../src/test/timeouts.js";

/**
 * Real, unmocked native-Windows coverage: every other Windows-specific test in this package mocks process.platform on a POSIX runner, which proves the branch logic but cannot prove the OS actually accepts a named-pipe path from Node's net module the way the unit tests assume. This file skips everywhere except a genuine win32 process, so it runs for real only on the CI job pinned to windows-latest and windows-11-arm.
 */
async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-win-"));
}

describe.skipIf(process.platform !== "win32")(
  "native Windows named-pipe integration",
  { timeout: REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS },
  () => {
    test("a peer binds the default named-pipe path with no socketDir override", async () => {
      const home = await tempHome();
      const peer = await CcPeer.create({
        homeDir: home,
        name: "win-default",
        logger: () => {
          void 0;
        },
      });
      const roster = await peer.roster();
      expect(roster).toEqual([]);
      await peer.stop();
    });

    test("a raw client without a valid auth line is closed without delivering anything", async () => {
      const home = await tempHome();
      const peer = await CcPeer.create({
        homeDir: home,
        name: "win-reject",
        logger: () => {
          void 0;
        },
      });
      const messages: unknown[] = [];
      peer.on("message", (m) => {
        messages.push(m);
      });
      const socketPath = socketPathForPid(process.pid);
      const socket = connect(socketPath);
      await once(socket, "connect");
      socket.write('{"type":"auth","token":"' + "0".repeat(32) + '"}\n');
      socket.write(
        '{"msgV":1,"msg_id":"11111111-1111-4111-8111-111111111111","type":"user","message":{"role":"user","content":"<cross-session-message from=\\"uds:/x\\">\\nhi\\n</cross-session-message>"},"priority":"next","from":"uds:/x"}\n',
      );
      await once(socket, "close");
      expect(messages).toHaveLength(0);
      await peer.stop();
    });

    test("a raw client with the real published auth token is delivered", async () => {
      const home = await tempHome();
      const peer = await CcPeer.create({
        homeDir: home,
        name: "win-accept",
        logger: () => {
          void 0;
        },
      });
      const messages: unknown[] = [];
      peer.on("message", (m) => {
        messages.push(m);
      });
      const socketPath = socketPathForPid(process.pid);
      const keyStore = new FsKeyStore({ homeDir: home });
      const token = (await keyStore.readForSocket(socketPath))?.peerToken ?? "";
      const socket = connect(socketPath);
      await once(socket, "connect");
      socket.write('{"type":"auth","token":"' + token + '"}\n');
      socket.write(
        '{"msgV":1,"msg_id":"11111111-1111-4111-8111-111111111111","type":"user","message":{"role":"user","content":"<cross-session-message from=\\"uds:/x\\">\\nhi\\n</cross-session-message>"},"priority":"next","from":"uds:/x"}\n',
      );
      const deadline = Date.now() + 5_000;
      while (messages.length === 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 50);
          timer.unref();
        });
      }
      expect(messages).toHaveLength(1);
      socket.destroy();
      await peer.stop();
    });
  },
);
