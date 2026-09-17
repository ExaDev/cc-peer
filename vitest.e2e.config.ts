import { defineConfig } from "vitest/config";

// Separate root config, not a project under vitest.config.ts: e2e tests need a just-built SEA binary (CC_PEER_SEA_BINARY) that only exists inside the sea CI job's own context, never when pnpm test/test:coverage run, so it must never be picked up by those default invocations.
export default defineConfig({
  test: {
    include: ["test/**/*.e2e.test.ts"],
  },
});
