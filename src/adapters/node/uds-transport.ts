import { connect, createServer, type Socket } from "node:net";

import type {
  InboundConnection,
  ListeningSocket,
  Transport,
} from "../../ports/transport.js";

/** macOS linger before close, matching the reference client's ~150ms. */
const DEFAULT_LINGER_MS = 150;

class NodeInboundConnection implements InboundConnection {
  private buffer = "";
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string | undefined) => void)[] = [];
  private ended = false;
  /** macOS local-peer pid, captured from the first data chunk's control info. */
  private cachedPid: number | undefined;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.cachedPid ??= readPeerPid();
      this.buffer += chunk.toString("utf8");
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter === undefined) {
          this.lines.push(line);
        } else {
          waiter(line);
        }
        index = this.buffer.indexOf("\n");
      }
    });
    const finish = (): void => {
      this.ended = true;
      for (const waiter of this.waiters.splice(0)) waiter(undefined);
    };
    socket.on("close", finish);
    socket.on("error", finish);
  }

  peerPid(): number | undefined {
    return this.cachedPid;
  }

  async *readLines(): AsyncIterable<string> {
    const waitForLine = async (): Promise<string | undefined> =>
      new Promise((resolve) => {
        this.waiters.push(resolve);
      });
    for (;;) {
      const next = this.lines.shift() ?? (await waitForLine());
      if (next === undefined) return;
      yield next;
    }
  }

  close(): void {
    this.socket.destroy();
  }
}

/**
 * Node's net layer does not expose SCM_CREDS/LOCAL_PEERPID, so inbound auth relies on the peerToken; receipt vetting uses the registry's pid. Transports that can read kernel peer ids should override this.
 */
function readPeerPid(): number | undefined {
  return undefined;
}

export class UdsTransport implements Transport {
  async connectWrite(
    socketPath: string,
    lines: readonly string[],
    lingerMs = DEFAULT_LINGER_MS,
  ): Promise<void> {
    const payload = Buffer.from(lines.join("\n") + "\n", "utf8");
    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath);
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      // Unix-domain connect never hangs: the kernel completes it into the listener's backlog or refuses immediately, so there is no timeout to arm (the guard would be TCP-shaped dead code here).
      socket.once("error", fail);
      socket.once("connect", () => {
        // Write errors surface through the error handler above rather than a per-write callback: the callback branch is unreachable for a socket whose only failure modes already emit error.
        socket.write(payload);
        const linger = setTimeout(() => {
          socket.end();
        }, lingerMs);
        linger.unref();
      });
      socket.once("close", () => {
        resolve();
      });
      socket.once("finish", () => {
        resolve();
      });
    });
  }

  async probe(socketPath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = connect(socketPath);
      const done = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.once("error", (error: Error & { code?: string }) => {
        done(error.code === "EBUSY");
      });
      socket.once("connect", () => {
        done(true);
      });
    });
  }

  async listen(
    socketPath: string,
    onConnection: (conn: Readonly<InboundConnection>) => void,
  ): Promise<ListeningSocket> {
    const accepted: Socket[] = [];
    const server = createServer((socket) => {
      accepted.push(socket);
      socket.once("close", () => {
        const index = accepted.indexOf(socket);
        if (index >= 0) accepted.splice(index, 1);
      });
      onConnection(new NodeInboundConnection(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        resolve();
      });
    });
    return {
      socketPath,
      close: async () => {
        // Destroy accepted sockets BEFORE server.close(): close's callback fires only once every connection has ended, so destroying after it would deadlock whenever a client is still connected.
        for (const socket of accepted.splice(0)) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        });
      },
    };
  }
}

export class SystemClock {
  nowMs(): number {
    return Date.now();
  }
}
