// Generates the golden fixture + its hash using the REAL canonical module.
// Run: node --experimental-strip-types scripts/gen-golden.mjs
// This is a dev tool, not part of the app bundle.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalYaml, hashSuiteYaml } from "../src/services/canonical.ts";
import { goldenSuite } from "../src/services/canonical.golden.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "src", "services", "__fixtures__");
mkdirSync(fixtureDir, { recursive: true });

const yaml = canonicalYaml(goldenSuite);
const hash = await hashSuiteYaml(yaml);

writeFileSync(join(fixtureDir, "canonical-golden.yaml"), yaml);
writeFileSync(join(fixtureDir, "canonical-golden.hash"), hash + "\n");

console.log("Wrote fixture + hash:");
console.log(hash);
console.log("--- YAML ---");
console.log(yaml);