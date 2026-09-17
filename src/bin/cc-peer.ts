#!/usr/bin/env node
import process from "node:process";

import { main } from "./main.js";

void main().catch((error: unknown) => {
  process.stderr.write(
    `[cc-peer] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
