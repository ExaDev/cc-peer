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

/** Long enough that two distinct socketDir values collide only by the same astronomically small chance any truncated hash does; short enough to keep the pipe name readable. */
const PIPE_NAMESPACE_HEX_LENGTH = 8;

/**
 * Short, path-safe token distinguishing one caller-supplied socketDir from another in a Windows pipe name. A named pipe has no filesystem directory of its own to carry that distinction the way a POSIX socket path does, so the directory is folded into the name instead.
 */
function pipeNamespace(socketDir: string): string {
  return createHash("sha256")
    .update(socketDir)
    .digest("hex")
    .slice(0, PIPE_NAMESPACE_HEX_LENGTH);
}

/**
 * On native Windows, Claude Code's own inbox is a named pipe rather than a Unix domain socket — Node's net module has no filesystem-path AF_UNIX support there at all (see docs/PROTOCOL.md), so unlike every other config override in this module, an explicit socketDir can never become a literal filesystem path on Windows: net.Server.listen() would reject it with EACCES regardless of what directory it names. Node still dispatches to the right OS primitive from the path's own shape, so UdsTransport needs no change; only path construction does. A caller-supplied socketDir keeps its usual purpose — separating one caller's sockets from another's, e.g. across concurrent test runs — by namespacing the pipe name instead of pointing at a real directory. The exact pipe name only needs to be unique per pid (and per socketDir) on this machine, not to match any specific value a real Windows Claude Code session uses.
 */
export function socketPathForPid(
  pid: number,
  config: Readonly<PathConfig> = {},
): string {
  if (isWindows()) {
    const namespace =
      config.socketDir === undefined
        ? ""
        : `-${pipeNamespace(config.socketDir)}`;
    return `${WINDOWS_PIPE_PREFIX}cc-peer${namespace}-${pid.toString()}`;
  }
  // An explicit socketDir always wins on POSIX, matching socketDirCandidates' own precedence rule: it is a full override of automatic path construction, not merely a candidate to prefer.
  if (config.socketDir !== undefined) {
    return `${config.socketDir}/${pid.toString()}.sock`;
  }
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
  // A named-pipe path is detected by its own shape, not the current platform: parsing should work on whichever kind of path it is actually given, not on where the parsing code itself happens to run. The pid is always the final `-`-delimited segment, whether or not a socketDir namespace segment precedes it (see pipeNamespace above).
  if (socketPath.startsWith(WINDOWS_PIPE_PREFIX)) {
    const name = socketPath.slice(WINDOWS_PIPE_PREFIX.length);
    const pid = Number.parseInt(name.slice(name.lastIndexOf("-") + 1), 10);
    return Number.isNaN(pid) ? 0 : pid;
  }
  // substring after the final slash: split().at(-1) would need an unreachable empty-array fallback.
  const base = socketPath.substring(socketPath.lastIndexOf("/") + 1);
  const pid = Number.parseInt(base.replace(/\.sock$/, ""), 10);
  return Number.isNaN(pid) ? 0 : pid;
}

/** Temporary-suffix helper keeping pid interpolations string-typed for lint. */
export const tmpSuffix = (): string => `tmp-${process.pid.toString()}`;
