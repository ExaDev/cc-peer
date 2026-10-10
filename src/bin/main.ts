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

/** Outcome of parsing the command line: run the facade, print usage, or reject the arguments. */
export type CliCommand =
  | { kind: "run"; args: CliArgs }
  | { kind: "help" }
  | { kind: "error"; message: string };

export const USAGE = `Usage: cc-peer [options]

Starts the cc-peer REST facade on loopback and registers a peer for this process.

Options:
  --port <number>   Port to listen on (default: an ephemeral port)
  --token <string>  Bearer token to require (default: a generated token)
  --no-token        Disable bearer-token authentication
  --name <string>   Peer name shown to Claude Code sessions
  --home <path>     Home directory containing .claude (default: the current user's)
  -h, --help        Print this help and exit
`;

const MAX_PORT = 65_535;

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--port",
  "--token",
  "--name",
  "--home",
]);

/**
 * Parses command-line arguments (without the node and script entries) without any side effects.
 * `-h` and `--help` win over everything else; an unknown argument, a value flag with no value, or a
 * `--port` that is not an integer from 0 to 65535 yields an error command.
 */
export function parseArgs(argv: readonly string[]): CliCommand {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }
  const args: CliArgs = { noToken: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--no-token") {
      args.noToken = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) {
      return { kind: "error", message: `unknown argument: ${arg}` };
    }
    const value = argv[i + 1];
    if (value === undefined) {
      return { kind: "error", message: `${arg} requires a value` };
    }
    i += 1;
    if (arg === "--port") {
      const port = Number(value);
      if (!/^\d+$/.test(value) || port > MAX_PORT) {
        return { kind: "error", message: `invalid --port: ${value}` };
      }
      args.port = port;
    } else if (arg === "--token") {
      args.token = value;
    } else if (arg === "--name") {
      args.name = value;
    } else {
      args.home = value;
    }
  }

  return { kind: "run", args };
}

/**
 * Runs the CLI. Arguments are parsed before any peer is created or socket bound, so `--help` and
 * argument errors have no side effects beyond output; an argument error sets a non-zero exit code.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseArgs(argv);
  if (command.kind === "help") {
    process.stdout.write(USAGE);

    return;
  }
  if (command.kind === "error") {
    process.stderr.write(
      `[cc-peer] ${command.message}\nRun 'cc-peer --help' for usage.\n`,
    );
    process.exitCode = 2;

    return;
  }
  const { args } = command;

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
