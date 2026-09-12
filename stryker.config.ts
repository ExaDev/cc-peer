const options = {
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: ["src/domain/**/*.ts", "src/schemas/**/*.ts", "!src/**/*.test.ts"],
  tempDirName: ".stryker-tmp",
};

export default options;
