import { exadevConfig } from "@exadev/eslint-config";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

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
      // Plain-JS build script outside the tsconfig project include.
      "scripts/build-sea.mjs",
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
