import process from "node:process";

import { CcPeer } from "../cc-peer.js";
import { createApiServer } from "../api/server.js";

export interface CliArgs {
  port?: number;
  token?: string;
  name?: string;
  home?: string;
  noToken: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { noToken: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next !== undefined) {
      args.port = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--token" && next !== undefined) {
      args.token = next;
      i += 1;
    } else if (arg === "--name" && next !== undefined) {
      args.name = next;
      i += 1;
    } else if (arg === "--home" && next !== undefined) {
      args.home = next;
      i += 1;
    } else if (arg === "--no-token") {
      args.noToken = true;
    }
  }
  return args;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const peer = await CcPeer.create({
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.home !== undefined ? { homeDir: args.home } : {}),
    logger: (message) => {
      process.stderr.write(`[cc-peer] ${message}\n`);
    },
  });

  const server = await createApiServer(peer, {
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.token !== undefined ? { token: args.token } : {}),
    noToken: args.noToken,
  });

  process.stderr.write(
    `[cc-peer] REST facade listening on http://127.0.0.1:${server.port.toString()}\n`,
  );
  if (server.token !== undefined) {
    process.stderr.write(`[cc-peer] bearer token: ${server.token}\n`);
    process.stderr.write(
      "[cc-peer] example: curl -H 'Authorization: Bearer <token>' http://127.0.0.1:" +
        server.port.toString() +
        "/sessions\n",
    );
  }

  const shutdown = async (): Promise<void> => {
    await server.close();
    await peer.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
