import { spawn } from "node:child_process";

/**
 * The errno code of an unknown throwable: Node's process.kill throws a SystemError carrying a string code, but a defensive caller may hand us anything, so the narrowing is explicit rather than assumed. Exported for direct unit coverage of every narrowing side.
 */
export function errnoOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "";
}

/** Shared existence probe for PsProcInfo and WinProcInfo: no throw means the pid is live; EPERM means it exists but belongs to another user (still live, and Node emulates this check on Windows too); ESRCH (or any other code) means it is gone. */
export async function signalZeroAlive(pid: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      process.kill(pid, 0);
      resolve(true);
    } catch (error) {
      resolve(errnoOf(error) === "EPERM");
    }
  });
}

/** Shared per-pid cache and in-flight dedup for a proc-info command runner, used by both PsProcInfo and WinProcInfo. */
export class CachedPidCommand {
  private readonly cache = new Map<
    number,
    { at: number; value: string | undefined }
  >();
  private static readonly CACHE_MS = 60_000;
  private readonly inFlight = new Map<number, Promise<string | undefined>>();

  async run(
    pid: number,
    command: string,
    args: readonly string[],
  ): Promise<string | undefined> {
    const cached = this.cache.get(pid);
    if (
      cached !== undefined &&
      Date.now() - cached.at < CachedPidCommand.CACHE_MS
    ) {
      return Promise.resolve(cached.value);
    }
    const existing = this.inFlight.get(pid);
    if (existing !== undefined) return existing;
    const promise = new Promise<string | undefined>((resolve) => {
      const child = spawn(command, args, {
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      child.on("error", () => {
        resolve(undefined);
      });
      child.on("close", (code) => {
        const value = code === 0 && out.trim().length > 0 ? out : undefined;
        this.cache.set(pid, { at: Date.now(), value });
        resolve(value);
      });
    }).finally(() => {
      this.inFlight.delete(pid);
    });
    this.inFlight.set(pid, promise);
    return promise;
  }
}
