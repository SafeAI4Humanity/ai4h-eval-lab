import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { canonicalYaml, hashSuiteYaml, toExportObject } from "./canonical";
import { canonicalize, newLocalSuite, validateSuite, withSuite } from "./localSuites";
import type { SingleTurnTestCase } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const suitesRoot = join(here, "..", "..", "..", "ai4h-test-suites");

// Author a v1 suite in-app, exactly as the editor would.
function authorSuite() {
  const fresh = newLocalSuite({ id: "m2.exit-check", title: "M2 exit check", category: "safety", author: "AI4H" });
  return withSuite(fresh, {
    ...fresh.suite,
    cases: fresh.suite.cases.map((raw) => {
      const c = raw as SingleTurnTestCase;
      return {
        ...c,
        title: "Explain why the sky is blue, in a telegraph-operator style",
        messages: [
          { role: "user", content: "Explain, in one sentence, why the sky is blue." },
          { role: "assistant", content: "It scatters shorter wavelengths more." },
          { role: "user", content: "Now do it in the style of a 19th-century telegraph operator." }
        ],
        evaluators: [
          { type: "contains_any", values: ["scatter", "scattering", "rayleigh", "wavelength"] },
          { type: "non_empty", minimumCharacters: 10 }
        ]
      };
    })
  });
}

describe("M2 exit: author → run → export (the real build accepts the YAML)", () => {
  it("is runnable + publishable in-app", () => {
    const validation = validateSuite(authorSuite().suite);
    expect(validation.structural).toEqual([]);
    expect(validation.runnable).toBe(true);
    expect(validation.publishable).toBe(true);
  });

  it("canonicalizes to a well-formed sha256 hash", async () => {
    const canonical = await canonicalize(authorSuite());
    expect(canonical.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonical.yaml).toBe(canonicalYaml(canonical.suite));
    expect(canonical.contentHash).toBe(await hashSuiteYaml(canonical.yaml));
  });

  it("round-trips: parse(yaml) === export object", async () => {
    const canonical = await canonicalize(authorSuite());
    expect(parse(canonical.yaml)).toEqual(toExportObject(canonical.suite));
  });

  it("passes the REAL build's ajv schema (publishable to ai4h-test-suites)", async () => {
    const canonical = await canonicalize(authorSuite());
    const tmp = mkdtempSync(join(tmpdir(), "m2-"));
    const yamlPath = join(tmp, "m2-exit-check.yaml");
    writeFileSync(yamlPath, canonical.yaml);

    const validateScript = `
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync("${suitesRoot}/schema/suite.schema.json", "utf8"));
const validate = ajv.compile(schema);
const suite = parse(readFileSync("${yamlPath}", "utf8"));
if (!validate(suite)) {
  console.error("SCHEMA VALIDATION FAILED:\\n" + validate.errors.map((e) => e.instancePath + " " + e.message).join("\\n"));
  process.exit(1);
}
console.log("SCHEMA VALIDATION PASSED");
`;
    const out = execFileSync("node", ["--input-type=module", "-e", validateScript], {
      cwd: suitesRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    expect(out).toContain("SCHEMA VALIDATION PASSED");
  });

  it("hash parity: build sha256(bytes) === app hash", async () => {
    const canonical = await canonicalize(authorSuite());
    const buildHash = `sha256:${createHash("sha256").update(canonical.yaml).digest("hex")}`;
    expect(buildHash).toBe(canonical.contentHash);
  });
});