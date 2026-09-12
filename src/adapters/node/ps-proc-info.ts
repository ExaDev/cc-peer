import { type ChildProcess, spawn } from "node:child_process";

import type { ProcInfo } from "../../ports/proc-info.js";

export class PsProcInfo implements ProcInfo {
  async alive(pid: number): Promise<boolean> {
    // Signal 0 is an existence probe: no throw means the pid is live; EPERM means it exists but belongs to another user (still live); ESRCH is gone.
    const errno = (error: unknown): string => {
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
      ) {
        return error.code;
      }
      return "";
    };
    return new Promise<boolean>((resolve) => {
      try {
        process.kill(pid, 0);
        resolve(true);
      } catch (error) {
        resolve(errno(error) === "EPERM");
      }
    });
  }

  /**
   * `ps -o lstart=` under forced C locale and UTC, returning the trimmed output byte-exact. The registry's liveness check string-compares this value, so the forced environment is load-bearing: bare `ps` follows the user's locale (day-before-month order under en_GB) and local time.
   */
  async lstart(pid: number): Promise<string | undefined> {
    const stdout = await this.runPs(pid);
    return stdout?.trim();
  }

  private readonly psCache = new Map<
    number,
    { at: number; value: string | undefined }
  >();
  private static readonly CACHE_MS = 60_000;
  private readonly inFlight = new Map<number, Promise<string | undefined>>();

  private async runPs(pid: number): Promise<string | undefined> {
    const cached = this.psCache.get(pid);
    if (cached !== undefined && Date.now() - cached.at < PsProcInfo.CACHE_MS) {
      return Promise.resolve(cached.value);
    }
    const existing = this.inFlight.get(pid);
    if (existing !== undefined) return existing;
    const promise = new Promise<string | undefined>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn("ps", ["-o", "lstart=", "-p", String(pid)], {
          env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        resolve(undefined);
        return;
      }
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      child.on("error", () => {
        resolve(undefined);
      });
      child.on("close", (code) => {
        this.psCache.set(pid, { at: Date.now(), value: out });
        resolve(code === 0 && out.trim().length > 0 ? out : undefined);
      });
    }).finally(() => {
      this.inFlight.delete(pid);
    });
    this.inFlight.set(pid, promise);
    return promise;
  }
}
