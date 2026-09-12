import type { RegistryEntry } from "../schemas/registry.js";

/** Registry port: the ~/.claude/sessions/<pid>.json store. */
export interface RegistryStore {
  list: () => Promise<RegistryEntry[]>;
  read: (pid: number) => Promise<RegistryEntry | undefined>;
  write: (entry: RegistryEntry) => Promise<void>;
  /** Heartbeat: bump updatedAt/statusUpdatedAt without rewriting the rest. */
  touch: (pid: number) => Promise<void>;
  remove: (pid: number) => Promise<void>;
}
