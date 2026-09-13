import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { CcPeer, PeerRef } from "../cc-peer.js";
import {
  apiComponentSchemas,
  IdleSubscriptionRequestSchema,
  SendMessageRequestSchema,
  type ApiComponentName,
} from "./schemas.js";

/** Loopback only; this bridges onto a same-user IPC trust boundary. */
const BIND_HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", `[${BIND_HOST}]`]);
/** API tokens are 24 random bytes in hex. */
const API_TOKEN_BYTES = 24;
const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL = 500;

export interface ApiServerOptions {
  port?: number;
  /** Supply to fix the bearer token; otherwise one is generated and printed once. */
  token?: string;
  /** Explicit opt-out for throwaway local use. */
  noToken?: boolean;
}

export interface ApiServer {
  port: number;
  token: string | undefined;
  close: () => Promise<void>;
}

export async function createApiServer(
  peer: CcPeer,
  options: Readonly<ApiServerOptions> = {},
): Promise<ApiServer> {
  const token =
    options.noToken === true
      ? undefined
      : (options.token ?? randomBytes(API_TOKEN_BYTES).toString("hex"));
  const server = createServer((req, res) => {
    void handle(peer, req, res, token);
  });
  return new Promise<ApiServer>((resolve) => {
    server.listen(options.port ?? 0, BIND_HOST, () => {
      const port = listeningPort(server.address());
      resolve({
        port,
        token,
        close: async () => {
          await new Promise<void>((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          });
        },
      });
    });
  });
}

async function handle(
  peer: CcPeer,
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined,
): Promise<void> {
  const finish = (status: number, body: string): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      // CORS stays off: this is a loopback bridge on a same-user trust boundary.
      "cache-control": "no-store",
    });
    res.end(body);
  };
  // DNS-rebinding defence: only localhost Host headers are served.
  const host = hostnameOf(req.headers.host);
  if (!ALLOWED_HOSTS.has(host)) {
    finish(HTTP_FORBIDDEN, errorBody("host not allowed"));
    return;
  }
  if (token !== undefined) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${token}`) {
      finish(HTTP_UNAUTHORIZED, errorBody("unauthorized"));
      return;
    }
  }
  const url = requestUrl(req.url, req.headers.host);
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      finish(HTTP_OK, JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/openapi.json") {
      finish(HTTP_OK, JSON.stringify(openApiDocument()));
      return;
    }
    if (req.method === "GET" && url.pathname === "/sessions") {
      const roster = await peer.roster();
      finish(HTTP_OK, JSON.stringify({ sessions: roster }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const request = SendMessageRequestSchema.parse(
        JSON.parse(await readBody(req)),
      );
      const sent = await peer.send(toPeerRef(request.to), request.body, {
        ...(request.priority !== undefined
          ? { priority: request.priority }
          : {}),
        ...(request.fromMode !== undefined
          ? { fromMode: request.fromMode }
          : {}),
      });
      finish(HTTP_ACCEPTED, JSON.stringify(sent));
      return;
    }
    if (req.method === "POST" && url.pathname === "/idle-subscriptions") {
      const request = IdleSubscriptionRequestSchema.parse(
        JSON.parse(await readBody(req)),
      );
      const sent = await peer.subscribeIdle(toPeerRef(request.to));
      finish(HTTP_ACCEPTED, JSON.stringify(sent));
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      streamEvents(peer, req, res);
      return;
    }
    finish(HTTP_NOT_FOUND, errorBody("not found"));
  } catch (error) {
    finish(HTTP_INTERNAL, errorBody(httpErrorMessage(error)));
  }
}

/**
 * Extract the numeric port `createApiServer` reports after `listen()`. The server always listens on a TCP host:port pair (never a named pipe), so `address()` returning anything but an AddressInfo object is a Node behaviour our own call site cannot trigger; a thrown error surfaces that violated assumption loudly rather than silently reporting port 0. Exported so the impossible-input side is directly unit-coverable without mocking node:net.
 */
export function listeningPort(address: string | AddressInfo | null): number {
  if (address === null || typeof address !== "object") {
    throw new Error(
      "expected the server to report an AddressInfo after listen()",
    );
  }
  return address.port;
}

/**
 * Extract the hostname portion of a Host header, ignoring any port suffix. Uses indexOf/slice rather than split()[0] so every branch is genuinely reachable: an absent header is a legitimate "reject as disallowed" case, and a header with no colon is the common case, both real inputs a test can construct directly, unlike split()[0]'s type-only undefined case.
 */
export function hostnameOf(hostHeader: string | undefined): string {
  if (hostHeader === undefined) return "";
  const colonIndex = hostHeader.indexOf(":");
  return colonIndex === -1 ? hostHeader : hostHeader.slice(0, colonIndex);
}

/**
 * Build the request URL from possibly-absent raw parts. Exported as a pure function so both undefined sides of the fallbacks are directly coverable (Node always populates these for well-formed requests, but the types allow absence and malformed raw requests exercise it).
 */
export function requestUrl(
  rawUrl: string | undefined,
  host: string | undefined,
): URL {
  return new URL(rawUrl ?? "/", `http://${host ?? "localhost"}`);
}

/**
 * Map a caught throwable to an HTTP error body message. Exported for direct unit coverage of the non-Error side, which live handlers cannot produce (every throw site raises Error subclasses).
 */
export function httpErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/**
 * Narrow an already schema-refined target to exactly one PeerRef shape. Exported for direct unit coverage of the no-field throw, which the PeerTargetSchema refine makes unreachable through the HTTP surface.
 */
export function toPeerRef(
  to: Readonly<{
    pid?: number | undefined;
    name?: string | undefined;
    address?: string | undefined;
  }>,
): PeerRef {
  if (to.pid !== undefined) return { pid: to.pid };
  if (to.name !== undefined) return { name: to.name };
  if (to.address !== undefined) return { address: to.address };
  throw new Error("target must specify pid, name, or address");
}

function errorBody(message: string): string {
  return JSON.stringify({ error: message });
}

function streamEvents(
  peer: CcPeer,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(HTTP_OK, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const forward = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onMessage = (m: unknown): void => {
    forward("message", m);
  };
  const onReceipt = (r: unknown): void => {
    forward("receipt", r);
  };
  const onIdle = (n: unknown): void => {
    forward("idle", n);
  };
  peer.on("message", onMessage);
  peer.on("receipt", onReceipt);
  peer.on("idle", onIdle);
  req.on("close", () => {
    peer.off("message", onMessage);
    peer.off("receipt", onReceipt);
    peer.off("idle", onIdle);
  });
  res.write(": connected\n\n");
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      resolve(data);
    });
  });
}

function ref(name: ApiComponentName): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

/**
 * OpenAPI 3.1 document: hand-authored paths/operations (which Zod cannot express) with every component schema converted losslessly from the same Zod definitions the server parses request bodies with — 3.1 components are JSON Schema 2020-12, so z.toJSONSchema output embeds directly.
 */
function openApiDocument(): Record<string, unknown> {
  const components = apiComponentSchemas();
  const jsonBody = (name: ApiComponentName): Record<string, unknown> => ({
    required: true,
    content: { "application/json": { schema: ref(name) } },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "cc-peer",
      version: "1.0.0",
      description:
        "REST facade over Claude Code's local cross-session peer messaging. Loopback only; bearer-token auth by default.",
    },
    servers: [{ url: `http://${BIND_HOST}` }],
    paths: {
      "/healthz": {
        get: {
          summary: "Liveness probe",
          responses: { "200": { description: "OK" } },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This document",
          responses: { "200": { description: "OpenAPI document" } },
        },
      },
      "/sessions": {
        get: {
          summary: "Live peer roster with admission checks applied",
          responses: {
            "200": {
              description: "Roster entries",
              content: {
                "application/json": { schema: ref("RosterResponse") },
              },
            },
          },
        },
      },
      "/messages": {
        post: {
          summary: "Send a message to a peer by pid, name, or address",
          requestBody: jsonBody("SendMessageRequest"),
          responses: {
            "202": {
              description: "Queued; delivery receipts arrive on /events",
              content: { "application/json": { schema: ref("SendAccepted") } },
            },
            "400": {
              description: "Invalid request body",
              content: { "application/json": { schema: ref("ErrorResponse") } },
            },
          },
        },
      },
      "/idle-subscriptions": {
        post: {
          summary: "Subscribe for a peer's next idle (or exit) notice",
          requestBody: jsonBody("IdleSubscriptionRequest"),
          responses: {
            "202": {
              description: "Subscribed; notices arrive on /events",
              content: { "application/json": { schema: ref("SendAccepted") } },
            },
          },
        },
      },
      "/events": {
        get: {
          summary: "SSE stream of inbound messages, receipts, and idle notices",
          responses: { "200": { description: "text/event-stream" } },
        },
      },
    },
    components: {
      schemas: components,
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearer: [] }],
  };
}
