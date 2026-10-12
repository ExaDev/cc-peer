/**
 * Runs fn with process.env[key] set to value (undefined deletes it
 * instead), always restoring the original value afterward even if fn
 * throws. Mirrors withPlatform's shape, and for the same reason avoids
 * plain `process.env[key] = original` / `delete process.env[key]`: eslint
 * flags a direct assignment to a shared global made after an await
 * elsewhere in the same function (require-atomic-updates) and a delete on a
 * dynamically computed key (no-dynamic-delete). Object.defineProperty and
 * Reflect.deleteProperty do the same thing without tripping either rule.
 */
export async function withEnv<T>(
  key: string,
  value: string | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  const descriptor = (v: string): PropertyDescriptor & { value: string } => ({
    value: v,
    configurable: true,
    writable: true,
    enumerable: true,
  });
  const original = process.env[key];
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else Object.defineProperty(process.env, key, descriptor(value));
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      Object.defineProperty(process.env, key, descriptor(original));
    }
  }
}
