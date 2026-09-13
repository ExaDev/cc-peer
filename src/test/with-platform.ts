/**
 * Runs fn with process.platform reporting the given value, always restoring the real value afterward even if fn throws. process.platform's own property descriptor is configurable, so this is a standard way to exercise a platform branch without a real machine of that platform — the isWindows()-gated branches this covers only ever read process.platform, they don't depend on the kernel actually being that OS.
 */
export async function withPlatform<T>(
  value: NodeJS.Platform,
  fn: () => T | Promise<T>,
): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", {
      value: original,
      configurable: true,
    });
  }
}
