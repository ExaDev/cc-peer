import { describe, expect, test } from "vitest";

import { AliasPool } from "./alias-pool.js";
import { REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS } from "./test/timeouts.js";

describe("AliasPool.create default wiring", () => {
  test(
    "ensure() drives a real ForkedAliasProcess, which fails fast against the unbuilt worker path in this dev tree",
    async () => {
      // Exercises AliasPool.create()'s own spawn wiring for real (a bare unit test with an injected fake spawn never calls the real ForkedAliasProcess constructor). In this repo's own dev/test tree that means a real fork() against the .js sibling worker path, which only exists once `pnpm build` has run (see forked-alias-process.integration.test.ts's own default-construction test) — so this fails fast rather than hanging, which is itself the behaviour worth pinning: a broken or missing worker build surfaces as a rejected ensure(), never a silent no-op.
      const pool = AliasPool.create();
      await expect(pool.ensure("unbuilt-default-pool-test")).rejects.toThrow();
      expect(pool.activeAliases()).toEqual([]);
    },
    REAL_PROCESS_SPAWN_TEST_TIMEOUT_MS,
  );
});
