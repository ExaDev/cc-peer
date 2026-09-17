import { defineConfig, type UserConfig } from "tsdown";

/**
 * The SEA (single-executable application) build target: fully bundles every dependency — zod included — into one file with zero external requires, because a SEA embeds no node_modules of its own. Kept out of dist/ (via outDir: "dist-sea") so the SEA bundle never ships inside the published npm package. CommonJS, matching Node's SEA feature's original, longest- supported main-script format: the injected script runs via require() semantics, which cannot load top-level await (see src/sea-entry.ts, which keeps its own top level synchronous for exactly this reason). fixedExtension: true always writes .cjs regardless of the package's own "type": "module", making the extension an unambiguous single source of truth for the mainFormat the SEA config derives from it.
 */
const seaEntryBuildConfig: UserConfig = {
  entry: ["src/sea-entry.ts"],
  format: ["cjs"],
  platform: "node",
  dts: false,
  clean: false,
  outDir: "dist-sea",
  fixedExtension: true,
  deps: {
    alwaysBundle: () => true,
  },
};

export default defineConfig([
  {
    // alias-worker.ts is listed as its own dedicated entry, not left to be pulled in transitively by alias-pool.ts, specifically so it is emitted as a real, directly-forkable file at a predictable path (tsdown preserves each declared entry's own src/ directory structure in dist/, so dist/adapters/node/alias-worker.mjs sits at exactly the same relative position to dist/alias-pool.mjs as the two source files do to each other) rather than being folded into one of the shared internal chunks tsdown otherwise splits code across entries into, whose exact filenames and locations are an implementation detail child_process.fork() cannot rely on.
    entry: [
      "src/cc-peer.ts",
      "src/bin/cc-peer.ts",
      "src/alias-pool.ts",
      "src/adapters/node/alias-worker.ts",
    ],
    outDir: "dist",
    format: ["esm", "cjs"],
    dts: true,
    platform: "node",
    fixedExtension: true,
    exports: false,
    attw: { profile: "node16" },
  },
  seaEntryBuildConfig,
]);
