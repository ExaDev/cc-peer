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
    // Pushes the version bump and changelog back to main as a real commit, tagged by @semantic-release/github below (which runs after, so the tag lands on this commit, not the one that triggered the release). Needs the exadev App's token, since the branch ruleset refuses a direct push to main from any other token — see ci.yml's own comment on generating it before checkout.
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    ["@semantic-release/github", { addReleases: "bottom" }],
  ],
};

export default config;
