import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PathConfig {
  homeDir?: string;
  socketDir?: string;
}

/**
 * Candidate socket directories, in the order the reference client accepts
 * them. The tuple return type guarantees at least one candidate exists, so
 * callers can index [0] without a fallback branch.
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

export function socketPathForPid(
  pid: number,
  config: Readonly<PathConfig> = {},
): string {
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
  // substring after the final slash: split().at(-1) would need an
  // unreachable empty-array fallback.
  const base = socketPath.substring(socketPath.lastIndexOf("/") + 1);
  const pid = Number.parseInt(base.replace(/\.sock$/, ""), 10);
  return Number.isNaN(pid) ? 0 : pid;
}

/** Temporary-suffix helper keeping pid interpolations string-typed for lint. */
export const tmpSuffix = (): string => `tmp-${process.pid.toString()}`;
