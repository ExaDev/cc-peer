import { describe, expect, test } from "vitest";

import { CachedPidCommand } from "./cached-command.js";

describe("CachedPidCommand", () => {
  test("a second call for the same pid inside the cache window is served from the cache", async () => {
    const command = new CachedPidCommand();
    const first = await command.run(process.pid, process.execPath, [
      "-e",
      "process.stdout.write('first')",
    ]);
    const second = await command.run(process.pid, process.execPath, [
      "-e",
      "process.stdout.write('second')",
    ]);
    expect(first).toBe("first");
    expect(second).toBe(first);
  });
});
