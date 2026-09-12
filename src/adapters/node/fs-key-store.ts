import { readFile, rename, unlink, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { KeyStore } from "../../ports/key-store.js";
import type { PeerKeyFile } from "../../schemas/keyfile.js";
import { PeerKeyFileSchema } from "../../schemas/keyfile.js";
import { keyFilePath, tmpSuffix, type PathConfig } from "./paths.js";

export class FsKeyStore implements KeyStore {
  constructor(private readonly config: Readonly<PathConfig> = {}) {}

  async readForSocket(socketPath: string): Promise<PeerKeyFile | undefined> {
    let raw: string;
    try {
      raw = await readFile(keyFilePath(socketPath, this.config), "utf8");
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const result = PeerKeyFileSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  async writeForSocket(
    socketPath: string,
    keyFile: Readonly<PeerKeyFile>,
  ): Promise<void> {
    const path = keyFilePath(socketPath, this.config);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${tmpSuffix()}`;
    await writeFile(tmp, `${JSON.stringify(keyFile)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  }

  async removeForSocket(socketPath: string): Promise<void> {
    await unlink(keyFilePath(socketPath, this.config)).catch(() => undefined);
  }
}
