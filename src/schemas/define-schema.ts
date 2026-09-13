import type { z } from "zod";

/**
 * Attach an `.is()` type guard to a Zod schema so schema, inferred type, and runtime guard derive from one definition (single source of truth). `Schema.parse()` at JSON boundaries; `Schema.is()` for narrowing.
 */
export function defineSchema<T extends z.ZodType>(schema: T) {
  // Object.assign is required over spread here: a Zod schema is a class instance, and spreading it would drop the prototype (parse, safeParse, refinements), so the guard is deliberately attached to the live instance. The no-object-assign rule is disabled for this file in eslint.config.ts.
  return Object.assign(schema, {
    is(value: unknown): value is z.infer<T> {
      return schema.safeParse(value).success;
    },
  });
}
