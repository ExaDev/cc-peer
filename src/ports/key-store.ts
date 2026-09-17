import type { PeerKeyFile } from "../schemas/keyfile.js";

/** Key-store port: auth keys published next to each session socket. */
export interface KeyStore {
  readForSocket: (socketPath: string) => Promise<PeerKeyFile | undefined>;
  /** Write our own key file for the socket we own. */
  writeForSocket: (
    socketPath: string,
    keyFile: Readonly<PeerKeyFile>,
  ) => Promise<void>;
  removeForSocket: (socketPath: string) => Promise<void>;
}
