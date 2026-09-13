import { createHash } from "node:crypto";
import { join } from "node:path";

import { isWindows } from "../adapters/node/paths.js";

/** Matches the length socketPathForPid's own pipeNamespace uses, so a test fixture's pipe name has the same collision odds as a real one. */
const NAMESPACE_HEX_LENGTH = 8;

/**
 * A unique, platform-appropriate socket path for test fixtures that need an arbitrary named target distinct from the pid-keyed paths socketPathForPid builds for a real peer's own listening socket (fixtures like "a second listener acting as a message target" have no pid of their own to key by). On POSIX this is a plain file under home; on Windows, home and label are folded into the pipe's own name, since a pipe has no filesystem directory of its own to keep concurrently-running fixtures apart the way a real directory does on POSIX.
 */
export function testSocketPath(home: string, label: string): string {
  if (isWindows()) {
    const namespace = createHash("sha256")
      .update(home)
      .digest("hex")
      .slice(0, NAMESPACE_HEX_LENGTH);
    return `\\\\.\\pipe\\cc-peer-test-${namespace}-${label}`;
  }
  return join(home, `${label}.sock`);
}
