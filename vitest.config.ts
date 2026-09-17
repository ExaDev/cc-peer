import { defineConfig } from "vitest/config";

// 100% thresholds: the test suite is the contract that every line and branch of src/ is exercised. Test files themselves are excluded from measurement. unit and integration are separate named projects so either tier can be run alone (pnpm test:unit / test:integration) for fast local iteration, but the default pnpm test / test:coverage runs both together with no --project filter — vitest merges their coverage into one map, preserving the same combined 100% gate this repo has always had. Splitting the gate itself is not viable here: cc-peer.ts's own orchestration and the Node adapters it wires together are legitimately proven by integration-tier tests exercising real sockets/processes, not by unit-tier fakes, so a unit-only coverage floor would only push toward over-mocking real component wiring rather than testing it. e2e (the packaged SEA binary) lives in its own vitest.e2e.config.ts entirely, never as a project here: it needs a just-built binary that exists only inside the sea CI job's own context.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.unit.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "src/**/*.integration.test.ts",
            "test/**/*.integration.test.ts",
          ],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry glue (bin firing wrappers, the SEA entry, the reply-alias worker) is exercised by the spawn-based smoke tests, not by in-process unit coverage; ports are type-only declarations with no runtime statements to cover.
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/bin/**",
        "src/sea-entry.ts",
        "src/ports/**",
        "src/adapters/node/alias-worker.ts",
      ],
      reporter: ["text", "html", "json-summary", "json"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
