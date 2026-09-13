import type { ProcInfo } from "../../ports/proc-info.js";
import { CachedPidCommand, signalZeroAlive } from "./cached-command.js";

export class PsProcInfo implements ProcInfo {
  private readonly command = new CachedPidCommand();

  async alive(pid: number): Promise<boolean> {
    return signalZeroAlive(pid);
  }

  /**
   * `ps -o lstart=` under forced C locale and UTC, returning the trimmed output byte-exact. The registry's liveness check string-compares this value, so the forced environment is load-bearing: bare `ps` follows the user's locale (day-before-month order under en_GB) and local time.
   */
  async lstart(pid: number): Promise<string | undefined> {
    const stdout = await this.command.run(pid, "ps", [
      "-o",
      "lstart=",
      "-p",
      pid.toString(),
    ]);
    return stdout?.trim();
  }
}
