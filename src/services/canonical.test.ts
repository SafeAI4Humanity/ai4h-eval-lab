import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { canonicalYaml, hashSuiteYaml, toExportObject } from "./canonical";
import { goldenSuite } from "./canonical.golden";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "__fixtures__");
const goldenYaml = readFileSync(join(fixtureDir, "canonical-golden.yaml"), "utf8");
const goldenHash = readFileSync(join(fixtureDir, "canonical-golden.hash"), "utf8").trim();

describe("canonicalYaml", () => {
  it("is deterministic (same input → same bytes)", () => {
    expect(canonicalYaml(goldenSuite)).toBe(canonicalYaml(goldenSuite));
  });

  it("round-trips semantically (no data lost through serialize→parse)", () => {
    const serialized = canonicalYaml(goldenSuite);
    const reparsed = parse(serialized);
    expect(reparsed).toEqual(toExportObject(goldenSuite));
  });

  it("pins the exact golden bytes (load-bearing: a serializer change fails here)", () => {
    expect(canonicalYaml(goldenSuite)).toBe(goldenYaml);
  });

  it("computes the pinned hash over the golden bytes", async () => {
    expect(await hashSuiteYaml(canonicalYaml(goldenSuite))).toBe(goldenHash);
  });

  it("strips app-internal fields from the export", () => {
    const exported = toExportObject(goldenSuite);
    expect(exported).not.toHaveProperty("sourceId");
    expect(exported).not.toHaveProperty("contentHash");
    // metadata order is fixed
    expect(Object.keys(exported).slice(0, 5)).toEqual([
      "schemaVersion",
      "id",
      "version",
      "title",
      "summary"
    ]);
  });
});