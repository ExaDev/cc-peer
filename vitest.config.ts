import { defineConfig } from "vitest/config";

// 100% thresholds: the test suite is the contract that every line and branch of src/ is exercised. Test files themselves are excluded from measurement.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry glue (bin firing wrappers, the SEA entry) is exercised by the spawn-based smoke and SEA smoke tests, not by in-process unit coverage; ports are type-only declarations with no runtime statements to cover.
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/bin/**",
        "src/sea-entry.ts",
        "src/ports/**",
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
