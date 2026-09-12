import type { GlobalConfig } from "semantic-release";

const config: GlobalConfig = {
  repositoryUrl: "git+https://github.com/ExaDev/cc-peer.git",
  tagFormat: "v${version}",
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { breaking: true, release: "major" },
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "docs", release: "patch" },
          { type: "style", release: "patch" },
          { type: "test", release: "patch" },
          { type: "build", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "chore", release: "patch" },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      { preset: "conventionalcommits" },
    ],
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    ["@semantic-release/npm", { pkgRoot: "." }],
    // @semantic-release/git is intentionally absent: its changelog commit-back
    // pushes directly to main, which the branch ruleset refuses for any token that is not the exadev App bypasser. Re-add it together with the App-token minting in ci.yml once the App private key is available as a repo secret; until then release notes live on the GitHub release only.
    ["@semantic-release/github", { addReleases: "bottom" }],
  ],
};

export default config;
