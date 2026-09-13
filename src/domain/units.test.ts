import { describe, expect, test } from "vitest";
import { Pacer } from "./pacer.js";
import { filterRoster } from "./roster.js";
import { assertRoundTrips } from "./envelope.js";
import type { RegistryEntry } from "../schemas/registry.js";
import type { ProcInfo } from "../ports/proc-info.js";
import type { Transport } from "../ports/transport.js";

/** Sentinel: the lstart probe reports no start string at all. */
const NO_START = "no-start";

class FakeClock {
  constructor(private now: number) {}
  nowMs(): number {
    return this.now;
  }
  advance(ms: number): void {
    this.now += ms;
  }
}

describe("Pacer", () => {
  test("refills tokens over elapsed time and blocks until one is available", () => {
    const clock = new FakeClock(1_000_000);
    const pacer = new Pacer(clock, 2, 0.5);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(false);
    // Zero elapsed time must not refill.
    expect(pacer.msUntilNextToken()).toBeGreaterThan(0);
    // 0.5 tokens/s: a full deficit token takes 2s.
    clock.advance(2_000);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(false);
    clock.advance(10_000);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(false);
  });

  test("capacity caps the refill", () => {
    const clock = new FakeClock(0);
    const pacer = new Pacer(clock, 1, 1);
    clock.advance(60_000);
    expect(pacer.tryReserve()).toBe(true);
    expect(pacer.tryReserve()).toBe(false);
  });

  test("msUntilNextToken is zero while tokens remain", () => {
    const pacer = new Pacer(new FakeClock(0), 3, 0.5);
    expect(pacer.msUntilNextToken()).toBe(0);
  });

  test("msUntilNextToken refills from elapsed time on its own, without a prior tryReserve", () => {
    const clock = new FakeClock(0);
    const pacer = new Pacer(clock, 1, 1);
    expect(pacer.tryReserve()).toBe(true);
    clock.advance(1_000);
    expect(pacer.msUntilNextToken()).toBe(0);
  });

  test("msUntilNextToken reports the exact wait for a fractional deficit", () => {
    const clock = new FakeClock(0);
    const pacer = new Pacer(clock, 1, 1);
    expect(pacer.tryReserve()).toBe(true);
    clock.advance(500);
    expect(pacer.msUntilNextToken()).toBe(500);
  });

  test("refill ignores a clock that moves backward rather than draining tokens", () => {
    const clock = new FakeClock(10_000);
    const pacer = new Pacer(clock, 1, 1);
    expect(pacer.tryReserve()).toBe(true);
    clock.advance(-5_000);
    expect(pacer.msUntilNextToken()).toBe(1_000);
  });
});

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    pid: 4242,
    sessionId: "s",
    cwd: "/",
    startedAt: 1,
    procStart: "start",
    version: "v",
    peerProtocol: 1,
    peerFeatures: [],
    kind: "interactive",
    entrypoint: "cli",
    pidDomain: "darwin",
    messagingSocketPath: "/tmp/x.sock",
    updatedAt: 1,
    ...overrides,
  };
}

function probes(
  overrides: Readonly<{
    alive?: boolean;
    /** NO_START means the probe reports no start string at all. */
    lstart?: string;
    probe?: boolean;
    ownSocketPath?: string;
  }>,
): {
  transport: Pick<Transport, "probe">;
  procInfo: ProcInfo;
  ownSocketPath?: string;
} {
  const resolveStart = (): string | undefined =>
    overrides.lstart === NO_START ? undefined : (overrides.lstart ?? "start");
  const lstart = async (): Promise<string | undefined> =>
    Promise.resolve(resolveStart());
  const alive = async (): Promise<boolean> =>
    Promise.resolve(overrides.alive ?? true);
  const probe = async (): Promise<boolean> =>
    Promise.resolve(overrides.probe ?? true);
  return {
    transport: { probe },
    procInfo: { alive, lstart },
    ...(overrides.ownSocketPath !== undefined
      ? { ownSocketPath: overrides.ownSocketPath }
      : {}),
  };
}

describe("filterRoster verdicts", () => {
  test("admits a fully live entry", async () => {
    const result = await filterRoster([entry()], probes({}));
    expect(result).toHaveLength(1);
  });

  test("excludes each documented failure reason", async () => {
    const noSocket = await filterRoster(
      [entry({ messagingSocketPath: "" })],
      probes({}),
    );
    expect(noSocket).toHaveLength(0);

    const own = await filterRoster(
      [entry()],
      probes({ ownSocketPath: "/tmp/x.sock" }),
    );
    expect(own).toHaveLength(0);

    const deadPid = await filterRoster([entry()], probes({ alive: false }));
    expect(deadPid).toHaveLength(0);

    const recycled = await filterRoster(
      [entry()],
      probes({ lstart: "different start" }),
    );
    expect(recycled).toHaveLength(0);

    const missingStart = await filterRoster(
      [entry()],
      probes({ lstart: NO_START }),
    );
    expect(missingStart).toHaveLength(0);

    const deadSocket = await filterRoster([entry()], probes({ probe: false }));
    expect(deadSocket).toHaveLength(0);
  });
});

describe("assertRoundTrips", () => {
  test("returns false for content that does not parse as an envelope", () => {
    expect(assertRoundTrips("not an envelope")).toBe(false);
    expect(
      assertRoundTrips(
        "<cross-session-message>no attrs</cross-session-message>",
      ),
    ).toBe(false);
  });
});
