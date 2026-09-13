import type { Clock } from "../ports/clock.js";

/** Receiver-side guard defaults this pacer mirrors. */
export const DEFAULT_BUCKET_CAPACITY = 30;
export const DEFAULT_REFILL_PER_SECOND = 0.5;
const MS_PER_SECOND = 1_000;

export interface PacerOptions {
  capacity?: number;
  refillPerSecond?: number;
}

/**
 * Outbound token bucket mirroring the receiver's admission rate limit (30 tokens, 0.5/s refill): sending faster than the target accepts gets messages dropped with reason "rate-limited". reserve() blocks until a token is available; a negative wait means tokens are already full.
 */
export class Pacer {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly clock: Readonly<Clock>,
    private readonly capacity: number = DEFAULT_BUCKET_CAPACITY,
    private readonly refillPerSecond: number = DEFAULT_REFILL_PER_SECOND,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = clock.nowMs();
  }

  /** Milliseconds to wait before one token is available (0 = now). */
  msUntilNextToken(): number {
    this.refill();
    const deficit = Math.max(0, 1 - this.tokens);
    return Math.ceil((deficit / this.refillPerSecond) * MS_PER_SECOND);
  }

  /** Consume one token if available. */
  tryReserve(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Clamps negative elapsed time (a clock moving backward) to zero rather than draining tokens, folding the guard into the arithmetic instead of a separate branch. */
  private refill(): void {
    const now = this.clock.nowMs();
    const elapsedSeconds = Math.max(
      0,
      (now - this.lastRefillMs) / MS_PER_SECOND,
    );
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefillMs = now;
  }
}
