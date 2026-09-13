import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PathConfig {
  homeDir?: string;
  socketDir?: string;
}

/** Named-pipe prefix Windows requires; a listen()/connect() path must live under it. */
const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";

export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Candidate socket directories, in the order the reference client accepts
 * them. The tuple return type guarantees at least one candidate exists, so
 * callers can index [0] without a fallback branch. Meaningless on Windows,
 * where a named pipe has no filesystem directory of its own — callers there
 * use socketPathForPid directly instead of building a path from a directory.
 */
export function socketDirCandidates(
  config: Readonly<PathConfig> = {},
): [string, ...string[]] {
  if (config.socketDir !== undefined) return [config.socketDir];
  // /tmp/cc-socks and /private/tmp/cc-socks (its realpath on macOS), plus the
  // XDG runtime and Termux variants the reference client also accepts.
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  return [
    "/tmp/cc-socks",
    "/private/tmp/cc-socks",
    ...(runtimeDir !== undefined ? [`${runtimeDir}/cc-socks`] : []),
  ];
}

export function sessionsDir(config: Readonly<PathConfig> = {}): string {
  return join(config.homeDir ?? homedir(), ".claude", "sessions");
}

/**
 * On native Windows, Claude Code's own inbox is a named pipe rather than a
 * Unix domain socket (Node's net module has no other IPC mechanism there —
 * see docs/PROTOCOL.md). Node dispatches to the right OS primitive from the
 * path's own shape, so UdsTransport needs no change; only path construction
 * does. The exact pipe name only needs to be unique per pid on this machine,
 * not to match any specific value a real Windows Claude Code session uses.
 */
export function socketPathForPid(
  pid: number,
  config: Readonly<PathConfig> = {},
): string {
  // An explicit socketDir always wins, on every platform, matching socketDirCandidates' own precedence rule: it is a full override of automatic path construction, not merely a candidate to prefer.
  if (config.socketDir !== undefined) {
    return `${config.socketDir}/${pid.toString()}.sock`;
  }
  if (isWindows()) return `${WINDOWS_PIPE_PREFIX}cc-peer-${pid.toString()}`;
  return `${socketDirCandidates(config)[0]}/${pid.toString()}.sock`;
}

export function registryFilePath(
  pid: number,
  config: Readonly<PathConfig> = {},
): string {
  return join(sessionsDir(config), `${pid.toString()}.json`);
}

/** Key files are named pid.sha256-of-canonical-socket-path with a .key suffix. */
export function keyFilePath(
  socketPath: string,
  config: Readonly<PathConfig> = {},
): string {
  const hash = createHash("sha256").update(socketPath).digest("hex");
  return join(
    sessionsDir(config),
    `${pidFromSocketPath(socketPath).toString()}.${hash}.key`,
  );
}

export function pidFromSocketPath(socketPath: string): number {
  // A named-pipe path is detected by its own shape, not the current platform: parsing should work on whichever kind of path it is actually given, not on where the parsing code itself happens to run.
  if (socketPath.startsWith(WINDOWS_PIPE_PREFIX)) {
    const name = socketPath.slice(WINDOWS_PIPE_PREFIX.length);
    const pid = Number.parseInt(name.replace(/^cc-peer-/, ""), 10);
    return Number.isNaN(pid) ? 0 : pid;
  }
  // substring after the final slash: split().at(-1) would need an unreachable empty-array fallback.
  const base = socketPath.substring(socketPath.lastIndexOf("/") + 1);
  const pid = Number.parseInt(base.replace(/\.sock$/, ""), 10);
  return Number.isNaN(pid) ? 0 : pid;
}

/** Temporary-suffix helper keeping pid interpolations string-typed for lint. */
export const tmpSuffix = (): string => `tmp-${process.pid.toString()}`;
