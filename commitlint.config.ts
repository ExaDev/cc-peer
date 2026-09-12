import type { UserConfig } from "@commitlint/types";

const commitTypes = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "style",
  "test",
  "build",
  "ci",
  "chore",
];

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", commitTypes],
  },
};

export default config;
