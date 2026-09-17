import type { ProcInfo } from "../../ports/proc-info.js";
import { CachedPidCommand, signalZeroAlive } from "./cached-command.js";

/**
 * Native Windows has no `ps`, so process-start-time verification uses PowerShell's own Process object instead. The exact string format is a cc-peer convention (round-trip ISO-8601, UTC), not a reproduction of whatever format a real native-Windows Claude Code session emits for its own registry entries — that value is not publicly documented and this implementation has not been verified against a live Windows Claude Code session. It is self-consistent for cc-peer's own entries (written and re-read with the same formatting), which is what roster admission actually needs for a peer this SDK itself created.
 */
export class WinProcInfo implements ProcInfo {
  private readonly command = new CachedPidCommand();

  async alive(pid: number): Promise<boolean> {
    return signalZeroAlive(pid);
  }

  async lstart(pid: number): Promise<string | undefined> {
    const script = `(Get-Process -Id ${pid.toString()} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
    const stdout = await this.command.run(pid, "powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return stdout?.trim();
  }
}
