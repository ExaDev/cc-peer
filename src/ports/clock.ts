/** Clock port: injectable time for pacer/refill and freshness windows. */
export interface Clock {
  nowMs: () => number;
}
