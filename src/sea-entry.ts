import { main } from "./bin/main.js";

// Node's single-executable application feature runs a CommonJS entry with
// no top-level await (https://nodejs.org/api/single-executable-applications.html):
// this is that entry, built separately from src/bin/cc-peer.ts as a fully
// bundled .cjs with zero external requires, since a SEA embeds no
// node_modules of its own. main stays genuinely async; only this top level
// is synchronous, which is all the CommonJS module system needs.
main().catch((error: unknown) => {
  process.stderr.write(
    `[cc-peer] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
