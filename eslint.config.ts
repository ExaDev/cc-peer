import { exadevConfig } from "@exadev/eslint-config";
import { defineConfig } from "eslint/config";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import type { Rule } from "eslint";

/**
 * Bans mutation-exemption comments in any form (the "Stryker" + "disable" pair, case-insensitive). The mutation score is gated at 100% (stryker.config.ts), so exempting a mutant anywhere is a silent hole in that gate: the ban keeps the score honest by forcing an unkilled mutant to be either killed by a test or fixed in the design, never waived by a comment.
 */
const noStrykerDisable: Rule.RuleModule = {
  create(context) {
    const comments = context.sourceCode.getAllComments();
    for (const comment of comments) {
      const loc = comment.loc;
      if (
        loc !== undefined &&
        loc !== null &&
        /stryker\s+disable/i.test(comment.value)
      ) {
        context.report({
          loc,
          message:
            "Mutation-exemption comments are banned: kill the mutant with a test or fix the design, never exempt it.",
        });
      }
    }

    return {};
  },
};

export default defineConfig(
  ...exadevConfig(),
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      ".turbo",
      ".stryker-tmp",
      "schemas",
      "dist-sea",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    plugins: {
      local: { rules: { "no-stryker-disable": noStrykerDisable } },
    },
    rules: { "local/no-stryker-disable": "error" },
  },
  /* Test fixtures legitimately encode raw protocol values (16-byte tokens,
     24-hex hop ids, chain lengths); naming them would obscure the fixture.
     Polling for an event and draining a stream are sequential by definition:
     each iteration depends on the observation made by the previous one. */
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
      "no-await-in-loop": "off",
    },
  },
  /* readLines is an async generator over a socket: each line is awaited
     before the next can be produced, so the loop cannot be parallelised. */
  {
    files: ["src/adapters/node/uds-transport.ts"],
    rules: { "no-await-in-loop": "off" },
  },
  /* Registry entries are read one at a time so the listing order and the
     number of open file handles stay bounded by one, whatever the directory
     holds. */
  {
    files: ["src/adapters/node/fs-registry-store.ts"],
    rules: { "no-await-in-loop": "off" },
  },
  /* The spool sweep stats and unlinks one file at a time so removal order
     and open handles stay bounded by one, and the first failed unlink stops
     the pass exactly as before. */
  {
    files: ["src/domain/file-transfer.ts"],
    rules: { "no-await-in-loop": "off" },
  },
  /* defineSchema attaches a guard to a live Zod class instance; spread would
     destroy the prototype, so Object.assign is the only correct tool there. */
  {
    files: ["src/schemas/define-schema.ts"],
    rules: { "exadev/no-object-assign": "off" },
  },
  eslintPluginPrettierRecommended,
);
