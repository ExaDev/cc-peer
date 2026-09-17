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
    entry: ["src/cc-peer.ts", "src/bin/cc-peer.ts"],
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
