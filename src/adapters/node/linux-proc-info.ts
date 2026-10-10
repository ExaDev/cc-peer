import { readFile } from "node:fs/promises";

import type { ProcInfo } from "../../ports/proc-info.js";
import { signalZeroAlive } from "./cached-command.js";

/** Index into the fields after the closing `)` in /proc/<pid>/stat: field 22 (starttime) is comm's own field 2 plus 20, so 22 - 3 = 19 fields into that remainder (state is the first). */
const STARTTIME_FIELD_INDEX = 19;

/**
 * Linux Claude Code sessions record procStart as /proc/<pid>/stat field 22
 * (starttime, in clock ticks since boot), not a `ps -o lstart=` date string;
 * that format is a macOS convention PsProcInfo reproduces. Reading the same
 * field the same way is what lets roster comparisons between a cc-peer entry
 * and a real Linux Claude Code entry agree. comm (field 2) is parenthesised
 * and may itself contain spaces or `)`, so the remaining fields are read from
 * the text after the *last* `)`, never by splitting the raw line on spaces.
 */
export class LinuxProcInfo implements ProcInfo {
  constructor(private readonly procRoot = "/proc") {}

  async alive(pid: number): Promise<boolean> {
    return signalZeroAlive(pid);
  }

  async lstart(pid: number): Promise<string | undefined> {
    let stat: string;
    try {
      stat = await readFile(`${this.procRoot}/${pid.toString()}/stat`, "utf8");
    } catch {
      return undefined;
    }
    const afterComm = stat.slice(stat.lastIndexOf(")") + 1).trim();
    const fields = afterComm.length > 0 ? afterComm.split(/\s+/) : [];
    const starttime = fields[STARTTIME_FIELD_INDEX];

    return starttime !== undefined && /^\d+$/.test(starttime)
      ? starttime
      : undefined;
  }
}
