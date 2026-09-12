import { describe, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { CcPeer } from "../src/cc-peer.js";
import { createApiServer } from "../src/api/server.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-peer-api-"));
}

function peerOptions(home: string) {
  return {
    homeDir: home,
    socketDir: join(home, "socks-api"),
    name: "api-test-peer",
    logger: () => {
      void 0;
    },
  };
}

describe("REST facade", () => {
  test("serves healthz, openapi, sessions, auth gate, and message send", async () => {
    const home = await tempHome();
    const peer = await CcPeer.create(peerOptions(home));
    const server = await createApiServer(peer, {});
    const base = `http://127.0.0.1:${server.port.toString()}`;
    const auth = { authorization: `Bearer ${server.token ?? ""}` };

    const health = await fetch(`${base}/healthz`, { headers: auth });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const spec = await fetch(`${base}/openapi.json`, { headers: auth });
    expect(spec.status).toBe(200);
    const document = (await spec.json()) as {
      openapi: string;
      components: { schemas: Record<string, { title?: string }> };
    };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.components.schemas)).toContain(
      "SendMessageRequest",
    );

    const unauthorized = await fetch(`${base}/sessions`);
    expect(unauthorized.status).toBe(401);

    // fetch refuses to override the forbidden Host header, so probe the
    // DNS-rebinding defence with a raw request that does set it.
    const rebinding = await new Promise<number>((resolve) => {
      const req = request(
        `${base}/healthz`,
        { headers: { Host: "evil.example.com" } },
        (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
        },
      );
      req.on("error", () => {
        resolve(0);
      });
      req.end();
    });
    expect(rebinding).toBe(403);

    const second = await CcPeer.create({
      homeDir: home,
      socketDir: join(home, "socks-api-2"),
      name: "api-test-target",
      logger: () => {
        void 0;
      },
    });
    const received: string[] = [];
    second.on("message", (m: Readonly<{ body: string }>) => {
      received.push(m.body);
    });

    const sessions = await fetch(`${base}/sessions`, { headers: auth });
    expect(sessions.status).toBe(200);
    const roster = (await sessions.json()) as { sessions: { name?: string }[] };
    expect(roster.sessions.some((s) => s.name === "api-test-target")).toBe(
      true,
    );

    const sent = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        to: { name: "api-test-target" },
        body: "hello via REST",
      }),
    });
    expect(sent.status).toBe(202);
    const accepted = (await sent.json()) as { msgId: string };
    expect(accepted.msgId).toMatch(/^[0-9a-f-]{36}$/);

    const invalid = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ body: "missing target" }),
    });
    expect(invalid.status).toBe(500);
    expect(((await invalid.json()) as { error: string }).error).toContain("to");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 2_000);
      timer.unref();
    });
    expect(received).toEqual(["hello via REST"]);

    await server.close();
    await second.stop();
    await peer.stop();
  }, 20_000);
});
