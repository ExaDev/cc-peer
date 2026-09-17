import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import { ForkedAliasProcess } from "./adapters/node/forked-alias-process.js";
import type { PathConfig } from "./adapters/node/paths.js";
import type { AliasProcess } from "./ports/alias-process.js";
import type { InboundMessage } from "./cc-peer.js";

export interface AliasPoolOptions extends PathConfig {
  logger?: (message: string) => void;
}

/** An inbound reply relayed from one alias, with the correspondent name it arrived for attached. */
export interface AliasMessage extends InboundMessage {
  alias: string;
}

/** Default log sink: logs go nowhere unless a logger is provided, matching CcPeer's own default. */
const sinkLog = (): void => undefined;

/**
 * alias-worker.ts's own built location, computed from this file's `import.meta.url` rather than ForkedAliasProcess's own: this file is itself a dedicated tsdown entry (see tsdown.config.ts), so its emitted location is stable and predictable, and alias-worker.ts (also a dedicated entry) is emitted at the same relative position to it as the two source files hold to each other in src/. The target extension mirrors this file's own real extension at runtime (`.mjs` or `.cjs`, tsdown's `fixedExtension: true`) rather than a hardcoded `.js`: tsdown builds matching-format sibling entries for every declared output, so alias-pool.mjs's own sibling is always alias-worker.mjs, never a plain `.js` neither format ever actually emits.
 */
const DEFAULT_WORKER_PATH = fileURLToPath(
  new URL(
    `./adapters/node/alias-worker${import.meta.url.endsWith(".cjs") ? ".cjs" : ".mjs"}`,
    import.meta.url,
  ),
);

interface Deps {
  spawn: () => AliasProcess;
}

/**
 * Lazily materialises one natively-discoverable Claude Code peer identity per mesh correspondent name, each backed by its own real OS process (see ports/alias-process.ts for why a real process is required). Emits "message" (an {@link AliasMessage}) for every reply an alias receives, and "exit" (an object with an `alias` name field) when an alias's backing process ends, whether from a deliberate retire() or an unexpected crash.
 */
export class AliasPool extends EventEmitter {
  private readonly active = new Map<string, AliasProcess>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly log: (message: string) => void;

  constructor(
    private readonly deps: Readonly<Deps>,
    private readonly options: Readonly<AliasPoolOptions> = {},
  ) {
    super();
    this.log = options.logger ?? sinkLog;
  }

  static create(options: Readonly<AliasPoolOptions> = {}): AliasPool {
    return new AliasPool(
      {
        spawn: () =>
          new ForkedAliasProcess({ workerPath: DEFAULT_WORKER_PATH }),
      },
      options,
    );
  }

  /** Idempotent: a no-op if the alias is already active, and dedup'd if another ensure() for the same name is already in flight. */
  async ensure(name: string): Promise<void> {
    if (this.active.has(name)) return;
    const inFlight = this.pending.get(name);
    if (inFlight !== undefined) {
      await inFlight;
      return;
    }
    const started = this.startAlias(name);
    this.pending.set(name, started);
    try {
      await started;
    } finally {
      this.pending.delete(name);
    }
  }

  private async startAlias(name: string): Promise<void> {
    const proc = this.deps.spawn();
    proc.events.on("message", (message: InboundMessage) => {
      this.emit("message", { alias: name, ...message } satisfies AliasMessage);
    });
    proc.events.on("exit", () => {
      this.active.delete(name);
      this.emit("exit", { alias: name });
    });
    await proc.start({
      name,
      ...(this.options.homeDir !== undefined
        ? { homeDir: this.options.homeDir }
        : {}),
      ...(this.options.socketDir !== undefined
        ? { socketDir: this.options.socketDir }
        : {}),
    });
    this.active.set(name, proc);
    this.log(`alias ${name} active`);
  }

  /** Waits for any in-flight ensure() of the same name to settle first, so a retire() issued while an alias is still starting stops it once (and if) it becomes active. A no-op for a name that is neither active nor pending. */
  async retire(name: string): Promise<void> {
    const inFlight = this.pending.get(name);
    if (inFlight !== undefined) {
      await inFlight.catch(() => undefined);
    }
    const proc = this.active.get(name);
    if (proc === undefined) return;
    this.active.delete(name);
    await proc.stop();
    this.log(`alias ${name} retired`);
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.active.keys()].map(async (name) => this.retire(name)),
    );
  }

  activeAliases(): string[] {
    return [...this.active.keys()];
  }
}
