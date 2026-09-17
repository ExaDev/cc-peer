const options = {
  testRunner: "vitest",
  // Named explicitly rather than left to auto-discovery: a fresh pnpm install's strict, non-flat node_modules layout does not expose
  // @stryker-mutator/vitest-runner the way auto-discovery expects, failing
  // with "Cannot find TestRunner plugin vitest" on a clean CI checkout even though the identical config resolves it fine against an already-populated local node_modules.
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  // define-schema.ts is excluded, not just left to ignoreStatic: every schema module assigns defineSchema's return value straight to a top-level export const, so a mutant that empties defineSchema's body poisons every module that imports it and crashes test collection across ten-plus files at once. That triggers a still-open
  // @stryker-mutator/vitest-runner bug (stryker-mutator/stryker-js#6150):
  // the runner's collection-failure path never sets its own failure flag, so a mutant that crashes every test in a file at import time is misreported Survived instead of Killed, confirmed directly by reproducing it manually and watching a real vitest run correctly fail ten files while stryker still reported the mutant as surviving. ignoreStatic was tried first but is too broad a fix: every schema definition in this codebase is itself a top-level const, so it silently zeroes out mutation testing for the entire schemas directory, not just this one function. Excluding only define-schema.ts (a three-line helper already exercised indirectly by every other schema's own tests) keeps the rest of the schema layer's mutation score meaningful.
  mutate: [
    "src/domain/**/*.ts",
    "src/schemas/**/*.ts",
    "!src/**/*.test.ts",
    "!src/schemas/define-schema.ts",
  ],
  tempDirName: ".stryker-tmp",
  // 100% across the board: a surviving mutant is a behaviour the test suite does not pin. Mutation-exemption comments are banned by the lint rule in eslint.config.ts: a mutant that genuinely cannot be killed is a design smell to fix, not to exempt.
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  ignorePatterns: ["dist", "dist-sea", "coverage", ".turbo"],
};

export default options;
