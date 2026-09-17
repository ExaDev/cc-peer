import { describe, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { UdsTransport } from "./uds-transport.js";
import { testSocketPath } from "../../test/socket-path.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-test-"));
}

describe("UdsTransport", () => {
  test("connectWrite delivers lines to a listening socket", async () => {
    const home = await tempHome();
    const sockPath = testSocketPath(home, "echo");
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
    const live = testSocketPath(home, "live");
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(live, () => {
        resolve();
      });
    });
    const transport = new UdsTransport();
    expect(await transport.probe(live)).toBe(true);
    expect(await transport.probe(testSocketPath(home, "missing"))).toBe(false);
    server.close();
  });
});
