/** Transport port: per-exchange connections and the listening inbox. */
export interface Transport {
  /**
   * One connection, one write of the given lines (each newline-terminated), then close after a short linger. Mirrors the reference client's `Pe`.
   */
  connectWrite: (
    socketPath: string,
    lines: readonly string[],
    lingerMs?: number,
  ) => Promise<void>;
  /** Probe whether a socket accepts connections (roster admission uses this). */
  probe: (socketPath: string) => Promise<boolean>;
  listen: (
    socketPath: string,
    onConnection: (conn: Readonly<InboundConnection>) => void,
  ) => Promise<ListeningSocket>;
}

export interface InboundConnection {
  /** Resolves once the kernel reports the connecting process's pid (macOS). */
  peerPid: () => number | undefined;
  readLines: () => AsyncIterable<string>;
  close: () => void;
}

export interface ListeningSocket {
  socketPath: string;
  close: () => Promise<void>;
}
