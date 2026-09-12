const options = {
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: ["src/domain/**/*.ts", "src/schemas/**/*.ts", "!src/**/*.test.ts"],
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
