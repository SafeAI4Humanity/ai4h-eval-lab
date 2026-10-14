import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { canonicalYaml, hashSuiteYaml, toExportObject } from "./canonical";
import { goldenSuite } from "./canonical.golden";
import {
  availableLocalSuites,
  getLocalSuites,
  setLocalSuites,
  canonicalize,
  newLocalSuite,
  validateSuite,
  withSuite
} from "./localSuites";
import { storage } from "./storage";
import type { LocalSuite, SingleTurnTestCase } from "../types";

describe("newLocalSuite", () => {
  it("produces a well-formed v1 scaffold that is not yet runnable (empty prompt)", () => {
    const local = newLocalSuite();
    const validation = validateSuite(local.suite);
    // The scaffold is structurally sound except the empty prompt, which the
    // schema rejects (content must be non-empty). So it's not runnable until
    // the author fills in a message.
    expect(validation.structural).toEqual([
      "cases.0.messages.0.content: String must contain at least 1 character(s)"
    ]);
    expect(validation.runnable).toBe(false);
    expect(local.dirty).toBe(true);
    expect(local.yaml).toBe(canonicalYaml(local.suite));
  });

  it("becomes runnable + publishable once a prompt is filled in", () => {
    const local = newLocalSuite();
    const filled = withSuite(local, {
      ...local.suite,
      cases: local.suite.cases.map((rawCase) => {
        const c = rawCase as SingleTurnTestCase;
        return {
          ...c,
          messages: c.messages.map((m) => ({ ...m, content: "Describe a harmless plan." }))
        };
      })
    });
    const validation = validateSuite(filled.suite);
    expect(validation.structural).toEqual([]);
    expect(validation.runnable).toBe(true);
    expect(validation.publishable).toBe(true);
  });
});

describe("validateSuite", () => {
  it("passes a known-good suite (the golden suite)", () => {
    const validation = validateSuite(goldenSuite);
    expect(validation.structural).toEqual([]);
    expect(validation.runnable).toBe(true);
    expect(validation.publishable).toBe(true);
  });

  it("flags a structurally invalid suite as not runnable", () => {
    const broken = { ...goldenSuite, title: "", cases: [] };
    const validation = validateSuite(broken);
    expect(validation.structural.length).toBeGreaterThan(0);
    expect(validation.runnable).toBe(false);
    expect(validation.publishable).toBe(false);
  });

  it("reports identity checks that gate publishability", () => {
    const validation = validateSuite(goldenSuite);
    // every identity check passes for the golden suite
    expect(validation.identity.every((check) => check.pass)).toBe(true);
  });
});

describe("canonicalize", () => {
  it("sets yaml + a real sha256 contentHash and clears dirty", async () => {
    const dirty = withSuite(newLocalSuite(), { ...goldenSuite });
    expect(dirty.dirty).toBe(true);
    expect(dirty.contentHash).toBeUndefined();

    const canonical = await canonicalize(dirty);
    expect(canonical.dirty).toBe(false);
    expect(canonical.yaml).toBe(canonicalYaml(canonical.suite));
    expect(canonical.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonical.contentHash).toBe(await hashSuiteYaml(canonical.yaml));
  });

  it("is stable: canonicalizing twice yields identical bytes + hash", async () => {
    const once = await canonicalize(withSuite(newLocalSuite(), { ...goldenSuite }));
    const twice = await canonicalize(once);
    expect(twice.yaml).toBe(once.yaml);
    expect(twice.contentHash).toBe(once.contentHash);
  });

  it("round-trips: parse(canonicalize) equals the export object", async () => {
    const canonical = await canonicalize(withSuite(newLocalSuite(), { ...goldenSuite }));
    expect(parse(canonical.yaml)).toEqual(toExportObject(canonical.suite));
  });
});

describe("withSuite", () => {
  it("marks the suite dirty and drops the stale hash", () => {
    const local = withSuite(newLocalSuite(), { ...goldenSuite });
    expect(local.dirty).toBe(true);
    expect(local.contentHash).toBeUndefined();
    // the yaml is NOT regenerated until canonicalize() runs
    expect(local.yaml).toBe(canonicalYaml(newLocalSuite().suite));
  });
});
// These inputs were accepted by the catalog loader but rejected by the real
// build. Publication must validate the exact exported object, without stripping
// unknown evaluator properties or relaxing length and numeric constraints.
describe("publication schema", () => {
  it.each([
    ["version format", { ...goldenSuite, version: "banana" }],
    ["empty title", { ...goldenSuite, title: "" }],
    ["short summary", { ...goldenSuite, summary: "short" }],
    ["short category", { ...goldenSuite, category: "x" }],
    ["short license", { ...goldenSuite, license: "x" }],
    ["short author", { ...goldenSuite, author: "x" }],
    ["short limitation", { ...goldenSuite, limitations: ["short"] }],
    ["invalid case id", { ...goldenSuite, cases: [{ ...(goldenSuite.cases[0] as SingleTurnTestCase), id: "Invalid ID" }] }],
    ["short rubric", { ...goldenSuite, cases: [{ ...(goldenSuite.cases[0] as SingleTurnTestCase), evaluators: [{ type: "human_review" as const, rubric: "short" }] }] }],
    ["excess temperature", { ...goldenSuite, cases: [{ ...(goldenSuite.cases[0] as SingleTurnTestCase), parameters: { temperature: 3 } }] }],
    ["obsolete evaluator fields", { ...goldenSuite, cases: [{ ...(goldenSuite.cases[0] as SingleTurnTestCase), evaluators: [{ type: "valid_json" as const, values: ["obsolete"] }] }] }]
  ])("rejects %s for publication", (_label, suite) => {
    const validation = validateSuite(suite);
    expect(validation.publication.length).toBeGreaterThan(0);
    expect(validation.publishable).toBe(false);
  });
});

describe("availableLocalSuites", () => {
  it("excludes dirty and structurally invalid drafts, including a saved empty prompt", async () => {
    const dirty = withSuite(newLocalSuite(), { ...goldenSuite });
    const valid = await canonicalize(dirty);
    const invalid = await canonicalize(newLocalSuite());
    expect(availableLocalSuites([dirty, invalid, valid])).toEqual([
      { ...goldenSuite, contentHash: valid.contentHash }
    ]);
  });
});

describe("legacy draft storage", () => {
  it("assigns and persists stable identities without changing existing draft content", () => {
    const original = newLocalSuite();
    const { localId: _oldId, ...legacy } = original;
    let stored = [legacy] as LocalSuite[];
    const read = vi.spyOn(storage, "getLocalSuites").mockImplementation(() => stored);
    const write = vi.spyOn(storage, "setLocalSuites").mockImplementation((next) => { stored = next; });
    try {
      const migrated = getLocalSuites();
      expect(migrated[0].localId).toBeTruthy();
      expect(migrated[0].suite).toEqual(original.suite);
      expect(migrated[0].yaml).toBe(original.yaml);
      setLocalSuites(migrated);
      expect(getLocalSuites()[0].localId).toBe(migrated[0].localId);
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
