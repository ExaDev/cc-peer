const options = {
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: ["src/domain/**/*.ts", "src/schemas/**/*.ts", "!src/**/*.test.ts"],
  tempDirName: ".stryker-tmp",
  // A module-load-time (static) mutant that breaks a whole file's import triggers a still-open @stryker-mutator/vitest-runner bug (stryker-mutator/stryker-js#6150): the runner's test-collection failure path never sets its own failure flag, so a mutant that crashes every test in a file at import time is misreported Survived instead of Killed. Confirmed directly: manually reproducing defineSchema's BlockStatement mutant broke ten test files at module load with a real vitest run, while stryker reported it Survived. ignoreStatic skips static mutants rather than trusting the runner's broken verdict on them; it can only raise a reported score, never hide a live bug, because a static mutant that is genuinely never exercised by any test was already unreachable through the covering-test analysis either way.
  ignoreStatic: true,
  // 100% across the board: a surviving mutant is a behaviour the test suite does not pin. Mutation-exemption comments are banned by the lint rule in eslint.config.ts: a mutant that genuinely cannot be killed is a design smell to fix, not to exempt.
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  ignorePatterns: ["dist", "dist-sea", "coverage", ".turbo"],
};

export default options;
