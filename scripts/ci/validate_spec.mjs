import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const schemaPath = path.join(projectRoot, "spec", "ui_spec.schema.json");
const specPath = path.join(projectRoot, "spec", "ui_spec.json");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const document = JSON.parse(fs.readFileSync(specPath, "utf-8"));

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const valid = validate(document);

if (!valid) {
  console.error("spec/ui_spec.json validation failed:\n");
  for (const err of validate.errors ?? []) {
    console.error(` • ${err.instancePath || "/"} ${err.message}`);
  }
  process.exit(1);
}

console.log("spec/ui_spec.json ✓ valid");
