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
  const verdicts = await Promise.all(
    entries.map(async (entry) => checkEntry(entry, probes)),
  );
  return verdicts.filter((v) => v.admitted).map((v) => v.entry);
}

/** Exported for direct unit coverage of each rejection reason, which filterRoster's own filtered-entries return value cannot distinguish. */
export async function checkEntry(
  entry: RegistryEntry,
  probes: RosterProbes,
): Promise<RosterVerdict> {
  if (entry.messagingSocketPath.length === 0) {
    return { entry, admitted: false, reason: "no-socket" };
  }
  // messagingSocketPath is already known non-empty (the no-socket check above returned first otherwise), so comparing it against an absent ownSocketPath is always false without a separate undefined guard.
  if (entry.messagingSocketPath === probes.ownSocketPath) {
    return { entry, admitted: false, reason: "own-socket" };
  }
  const alive = await probes.procInfo.alive(entry.pid);
  if (!alive) {
    return { entry, admitted: false, reason: "pid-dead" };
  }
  // entry.procStart is always a defined, non-empty string (schema-enforced), so an absent lstart already satisfies "differs from procStart" on its own without a separate undefined check.
  const lstart = await probes.procInfo.lstart(entry.pid);
  if (lstart !== entry.procStart) {
    return { entry, admitted: false, reason: "proc-start-mismatch" };
  }
  const connectable = await probes.transport.probe(entry.messagingSocketPath);
  if (!connectable) {
    return { entry, admitted: false, reason: "socket-dead" };
  }
  return { entry, admitted: true };
}
