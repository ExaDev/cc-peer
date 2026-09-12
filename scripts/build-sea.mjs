#!/usr/bin/env node
/**
 * Build single-executable cc-peer binaries with Node 26's built-in --build-sea. The bin is bundled to one self-contained CJS file first (SEA entry points cannot import node_modules), then handed to the platform's own node binary for embedding.
 *
 * Usage: node scripts/build-sea.mjs <output-name>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const outputName = process.argv[2] ?? "cc-peer";
const root = resolve(new URL(".", import.meta.url).pathname, "..");
const distDir = join(root, "dist", "sea");

mkdirSync(distDir, { recursive: true });

// 1. Bundle the bin entry to a single self-contained file.
execFileSync(
  "pnpm",
  [
    "exec",
    "tsdown",
    "--config",
    "tsdown.config.ts",
    "--entry",
    "src/bin/cc-peer.ts",
    "--format",
    "cjs",
    "--no-dts",
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

// Entry override flattens the output: the single entry lands at dist root.
const bundled = join(root, "dist", "cc-peer.cjs");
const work = mkdtempSync(join(tmpdir(), "cc-peer-sea-"));

// 2. Write the SEA config; `output` is the produced executable.
const seaConfig = join(work, "sea-config.json");
writeFileSync(
  seaConfig,
  `${JSON.stringify(
    {
      main: bundled,
      output: join(distDir, outputName),
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  )}\n`,
);

// 3. Node 26 embeds the blob itself: one flag, no postject.
execFileSync(process.execPath, ["--build-sea", seaConfig], {
  cwd: root,
  stdio: "inherit",
});

console.log(`built ${join(distDir, outputName)}`);
cpSync(seaConfig, join(distDir, "sea-config.json"));
