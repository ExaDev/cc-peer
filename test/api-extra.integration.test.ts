import { describe, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ReadableStreamDefaultReader,
  ReadableStreamReadResult,
} from "node:stream/web";

import { CcPeer } from "../src/cc-peer.js";
import { REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS } from "../src/test/timeouts.js";
import {
  createApiServer,
  hostnameOf,
  httpErrorMessage,
  listeningPort,
  requestUrl,
  toPeerRef,
} from "../src/api/server.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-api2-"));
}

async function peer(home: string, name: string, dir: string) {
  return CcPeer.create({
    homeDir: home,
    socketDir: join(home, dir),
    name,
    logger: () => {
      void 0;
    },
  });
}

describe("pure helpers", () => {
  test("requestUrl falls back to / and localhost when raw parts are absent", () => {
    const url = requestUrl(undefined, undefined);
    expect(url.pathname).toBe("/");
    expect(url.hostname).toBe("localhost");
  });

  test("requestUrl uses the given raw parts when present", () => {
    const url = requestUrl("/sessions?x=1", "127.0.0.1:9000");
    expect(url.pathname).toBe("/sessions");
    expect(url.hostname).toBe("127.0.0.1");
  });

  test("httpErrorMessage reads an Error's message and stringifies anything else", () => {
    expect(httpErrorMessage(new Error("boom"))).toBe("boom");
    expect(httpErrorMessage("plain string")).toBe('"plain string"');
    expect(httpErrorMessage({ code: 7 })).toBe('{"code":7}');
  });

  test("toPeerRef narrows by whichever field is present, pid taking priority", () => {
    expect(toPeerRef({ pid: 1 })).toEqual({ pid: 1 });
    expect(toPeerRef({ pid: 1, name: "x" })).toEqual({ pid: 1 });
    expect(toPeerRef({ name: "x" })).toEqual({ name: "x" });
    expect(toPeerRef({ address: "uds:/a.sock" })).toEqual({
      address: "uds:/a.sock",
    });
    expect(() => toPeerRef({})).toThrow("target must specify");
  });

  test("listeningPort reads the port from an AddressInfo and rejects anything else", () => {
    expect(
      listeningPort({ address: "127.0.0.1", family: "IPv4", port: 4242 }),
    ).toBe(4242);
    expect(() => listeningPort(null)).toThrow(
      "expected the server to report an AddressInfo",
    );
    expect(() => listeningPort("/tmp/some.sock")).toThrow(
      "expected the server to report an AddressInfo",
    );
  });

  test("hostnameOf strips a port suffix, passes through a bare host, and treats an absent header as empty", () => {
    expect(hostnameOf("127.0.0.1:9000")).toBe("127.0.0.1");
    expect(hostnameOf("localhost")).toBe("localhost");
    expect(hostnameOf(undefined)).toBe("");
  });
});

describe(
  "REST facade routes not covered by the happy-path test",
  { timeout: REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS },
  () => {
    test("an unknown path returns 404", async () => {
      const home = await tempHome();
      const p = await peer(home, "route-peer", "socks-a");
      const server = await createApiServer(p, {});
      const res = await fetch(
        `http://127.0.0.1:${server.port.toString()}/nope`,
        {
          headers: { authorization: `Bearer ${server.token ?? ""}` },
        },
      );
      expect(res.status).toBe(404);
      await server.close();
      await p.stop();
    });

    test("noToken:true serves without any authorization header", async () => {
      const home = await tempHome();
      const p = await peer(home, "no-token-peer", "socks-b");
      const server = await createApiServer(p, { noToken: true });
      expect(server.token).toBeUndefined();
      const res = await fetch(
        `http://127.0.0.1:${server.port.toString()}/healthz`,
      );
      expect(res.status).toBe(200);
      await server.close();
      await p.stop();
    });

    test("an explicit token option is honoured", async () => {
      const home = await tempHome();
      const p = await peer(home, "fixed-token-peer", "socks-c");
      const server = await createApiServer(p, { token: "fixed-secret" });
      expect(server.token).toBe("fixed-secret");
      const res = await fetch(
        `http://127.0.0.1:${server.port.toString()}/healthz`,
        {
          headers: { authorization: "Bearer fixed-secret" },
        },
      );
      expect(res.status).toBe(200);
      await server.close();
      await p.stop();
    });

    test("an explicit port option is honoured", async () => {
      const home = await tempHome();
      const p = await peer(home, "port-peer", "socks-d");
      const first = await createApiServer(p, { noToken: true });
      await first.close();
      const server = await createApiServer(p, {
        port: first.port,
        noToken: true,
      });
      expect(server.port).toBe(first.port);
      await server.close();
      await p.stop();
    });

    test("POST /idle-subscriptions subscribes and returns a msgId", async () => {
      const home = await tempHome();
      const sender = await peer(home, "idle-sender", "socks-e1");
      const target = await peer(home, "idle-target", "socks-e2");
      const server = await createApiServer(sender, {});
      const res = await fetch(
        `http://127.0.0.1:${server.port.toString()}/idle-subscriptions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${server.token ?? ""}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ to: { name: "idle-target" } }),
        },
      );
      expect(res.status).toBe(202);
      const accepted = (await res.json()) as { msgId: string };
      expect(accepted.msgId).toMatch(/^[0-9a-f-]{36}$/);
      await server.close();
      await sender.stop();
      await target.stop();
    });

    test("send by pid and by address succeed via REST", async () => {
      const home = await tempHome();
      const sender = await peer(home, "pid-sender", "socks-f1");
      const target = await peer(home, "pid-target", "socks-f2");
      const server = await createApiServer(sender, {});
      const auth = { authorization: `Bearer ${server.token ?? ""}` };

      const roster = await sender.roster();
      const targetEntry = roster.find((e) => e.name === "pid-target");
      expect(targetEntry).toBeDefined();

      const byPid = await fetch(
        `http://127.0.0.1:${server.port.toString()}/messages`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            to: { pid: targetEntry?.pid },
            body: "by pid",
          }),
        },
      );
      expect(byPid.status).toBe(202);

      const byAddress = await fetch(
        `http://127.0.0.1:${server.port.toString()}/messages`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            to: { address: targetEntry?.messagingSocketPath },
            body: "by address",
          }),
        },
      );
      expect(byAddress.status).toBe(202);

      await server.close();
      await sender.stop();
      await target.stop();
    });

    test("GET /events streams message, receipt, and idle events over SSE", async () => {
      const home = await tempHome();
      const p = await peer(home, "sse-peer", "socks-g");
      const server = await createApiServer(p, {});
      const controller = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${server.port.toString()}/events`,
        {
          headers: { authorization: `Bearer ${server.token ?? ""}` },
          signal: controller.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
        response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let buffered = "";

      async function readUntil(marker: string): Promise<void> {
        for (let i = 0; i < 50 && !buffered.includes(marker); i += 1) {
          const chunk: ReadableStreamReadResult<Uint8Array> | undefined =
            await reader?.read();
          if (chunk?.value !== undefined)
            buffered += decoder.decode(chunk.value);
        }
        expect(buffered).toContain(marker);
      }

      await readUntil(": connected");
      p.emit("message", { body: "hi", msgId: "m1" });
      await readUntil("event: message");
      p.emit("receipt", { status: "held" });
      await readUntil("event: receipt");
      p.emit("idle", { state: "idle" });
      await readUntil("event: idle");

      controller.abort();
      await server.close();
      await p.stop();
    }, 10_000);

    test("POST /messages forwards a supplied priority and fromMode to send", async () => {
      const home = await tempHome();
      const sender = await peer(home, "priority-sender", "socks-h1");
      const receiver = await peer(home, "priority-receiver", "socks-h2");
      const server = await createApiServer(sender, {});
      const response = await fetch(
        `http://127.0.0.1:${server.port.toString()}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${server.token ?? ""}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            to: { name: "priority-receiver" },
            body: "urgent",
            priority: "next",
            fromMode: "bypass",
          }),
        },
      );
      expect(response.status).toBe(202);
      await server.close();
      await sender.stop();
      await receiver.stop();
    });
  },
);
