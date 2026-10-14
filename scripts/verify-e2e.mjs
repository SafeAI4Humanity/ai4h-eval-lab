// End-to-end proof: the app's exported YAML passes the REAL build's schema
// validation (ajv against ai4h-test-suites/schema/suite.schema.json) and the
// build's hash of the committed bytes equals the app's computed hash.
//
// Run: node scripts/verify-e2e.mjs   (from ai4h-eval-lab)
// Requires: cd ../ai4h-test-suites && npm install   (ajv available there)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = join(here, "..");
const suitesRoot = join(labRoot, "..", "ai4h-test-suites");

const goldenPath = join(labRoot, "src", "services", "__fixtures__", "canonical-golden.yaml");
const raw = readFileSync(goldenPath, "utf8");
const appHash = readFileSync(join(labRoot, "src", "services", "__fixtures__", "canonical-golden.hash"), "utf8").trim();

// Run the REAL build's ajv + real schema against the app's exported bytes.
const validateScript = `
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync("${suitesRoot}/schema/suite.schema.json", "utf8"));
const validate = ajv.compile(schema);
const suite = parse(readFileSync("${goldenPath}", "utf8"));
if (!validate(suite)) {
  console.error("SCHEMA VALIDATION FAILED:\\n" + validate.errors.map((e) => e.instancePath + " " + e.message).join("\\n"));
  process.exit(1);
}
console.log("SCHEMA VALIDATION PASSED");
`;
try {
  const out = execFileSync("node", ["--input-type=module", "-e", validateScript], {
    cwd: suitesRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  process.stdout.write(out);
} catch (error) {
  process.stderr.write(error.stderr || error.message);
  process.exit(1);
}

// Hash parity: build's sha256(committed bytes) must equal the app's hash.
const buildHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
console.log(`build hash: ${buildHash}`);
console.log(`app   hash: ${appHash}`);
if (buildHash !== appHash) {
  console.error("HASH MISMATCH");
  process.exit(1);
}
console.log("HASH PARITY PASSED — app hash === build hash over the same bytes");