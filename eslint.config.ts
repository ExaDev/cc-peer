import { exadevConfig } from "@exadev/eslint-config";
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

export default exadevConfig(
  {},
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
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    plugins: {
      local: { rules: { "no-stryker-disable": noStrykerDisable } },
    },
    rules: { "local/no-stryker-disable": "error" },
  },
  /* Test fixtures legitimately encode raw protocol values (16-byte tokens,
     24-hex hop ids, chain lengths); naming them would obscure the fixture. */
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
  /* defineSchema attaches a guard to a live Zod class instance; spread would
     destroy the prototype, so Object.assign is the only correct tool there. */
  {
    files: ["src/schemas/define-schema.ts"],
    rules: { "exadev/no-object-assign": "off" },
  },
  eslintPluginPrettierRecommended,
);
