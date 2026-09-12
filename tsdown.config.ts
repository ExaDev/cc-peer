import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cc-peer.ts", "src/bin/cc-peer.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: true,
  platform: "node",
  fixedExtension: true,
  exports: false,
  attw: { profile: "node16" },
});
