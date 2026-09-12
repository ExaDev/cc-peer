import type { RegistryEntry } from "../schemas/registry.js";
import type { ProcInfo } from "../ports/proc-info.js";
import type { Transport } from "../ports/transport.js";

export interface RosterProbes {
  transport: Pick<Transport, "probe">;
  procInfo: ProcInfo;
  ownSocketPath?: string;
}

export interface RosterVerdict {
  entry: RegistryEntry;
  admitted: boolean;
  reason?:
    | "no-socket"
    | "own-socket"
    | "socket-dead"
    | "pid-dead"
    | "proc-start-mismatch";
}

/**
 * The receiver's own admission rules, verified live: an entry is listed when it has a socket, is not the caller's own, is not spare/parked, its socket accepts a live connect probe, and its pid is alive with a procStart that byte-matches the ps output. Mismatches classify as recycled and are silently skipped by the reference roster builder.
 */
export async function filterRoster(
  entries: readonly RegistryEntry[],
  probes: RosterProbes,
): Promise<RegistryEntry[]> {
  const verdicts: RosterVerdict[] = [];
  for (const entry of entries) {
    const verdict = await checkEntry(entry, probes);
    verdicts.push(verdict);
  }
  return verdicts.filter((v) => v.admitted).map((v) => v.entry);
}

async function checkEntry(
  entry: RegistryEntry,
  probes: RosterProbes,
): Promise<RosterVerdict> {
  if (entry.messagingSocketPath.length === 0) {
    return { entry, admitted: false, reason: "no-socket" };
  }
  if (
    probes.ownSocketPath !== undefined &&
    entry.messagingSocketPath === probes.ownSocketPath
  ) {
    return { entry, admitted: false, reason: "own-socket" };
  }
  const alive = await probes.procInfo.alive(entry.pid);
  if (!alive) {
    return { entry, admitted: false, reason: "pid-dead" };
  }
  const lstart = await probes.procInfo.lstart(entry.pid);
  if (lstart === undefined || lstart !== entry.procStart) {
    return { entry, admitted: false, reason: "proc-start-mismatch" };
  }
  const connectable = await probes.transport.probe(entry.messagingSocketPath);
  if (!connectable) {
    return { entry, admitted: false, reason: "socket-dead" };
  }
  return { entry, admitted: true };
}
