import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "schemas";

const schemas: Record<string, unknown> = {
  // Placeholder until milestone 2 wires the Zod schemas in.
  placeholder: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  writeFileSync(
    join(OUT_DIR, `${name}.schema.json`),
    `${JSON.stringify(schema, null, 2)}\n`,
  );
}
const count = String(Object.keys(schemas).length);
console.log("wrote " + count + " schema(s) to " + OUT_DIR + "/");
