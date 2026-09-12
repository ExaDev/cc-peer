import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { RegistryStore } from "../../ports/registry-store.js";
import type { RegistryEntry } from "../../schemas/registry.js";
import { RegistryEntrySchema } from "../../schemas/registry.js";
import {
  registryFilePath,
  sessionsDir,
  tmpSuffix,
  type PathConfig,
} from "./paths.js";

export class FsRegistryStore implements RegistryStore {
  constructor(private readonly config: Readonly<PathConfig> = {}) {}

  async list(): Promise<RegistryEntry[]> {
    const dir = sessionsDir(this.config);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const entries: RegistryEntry[] = [];
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue;
      const entry = await this.read(Number.parseInt(name, 10));
      if (entry !== undefined) entries.push(entry);
    }
    return entries;
  }

  async read(pid: number): Promise<RegistryEntry | undefined> {
    let raw: string;
    try {
      raw = await readFile(registryFilePath(pid, this.config), "utf8");
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const result = RegistryEntrySchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  async write(entry: RegistryEntry): Promise<void> {
    const path = registryFilePath(entry.pid, this.config);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${tmpSuffix()}`;
    await writeFile(tmp, `${JSON.stringify(entry)}\n`, { mode: 0o644 });
    await rename(tmp, path);
  }

  async touch(pid: number): Promise<void> {
    const entry = await this.read(pid);
    if (entry === undefined) return;
    const now = Date.now();
    await this.write({
      ...entry,
      updatedAt: now,
      ...(entry.status !== undefined ? { statusUpdatedAt: now } : {}),
    });
  }

  async remove(pid: number): Promise<void> {
    await unlink(registryFilePath(pid, this.config)).catch(() => undefined);
  }
}
