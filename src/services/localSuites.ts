import { canonicalYaml, hashSuiteYaml, toExportObject } from "./canonical";
import { singleTurnSuiteSchema } from "./catalog";
import { publicationSchemaErrors } from "./publicationSchema";
import { storage } from "./storage";
import type { LocalSuite, TestSuite } from "../types";

/**
 * Local suite authoring service (Tier 1, M2).
 *
 * Owns the persistence of locally-authored suites and the validation that lets
 * the editor surface the same errors the official build would. Structural
 * validation reuses the catalog loader's zod schema (single source of truth);
 * publication validation uses the pinned official schema; identity checks
 * mirror the build's duplicate-identity guards.
 *
 * See docs/SUITE_AUTHORING.md §4, §6, §10.
 */

const LOCAL_SOURCE_ID = "local";

/** Read all locally-authored suites. */
export function getLocalSuites(): LocalSuite[] {
  return storage.getLocalSuites().map((local) => ({ ...local, localId: local.localId ?? crypto.randomUUID() }));
}

/** Persist all locally-authored suites. */
export function setLocalSuites(suites: LocalSuite[]): void {
  storage.setLocalSuites(suites);
}

/** A fresh, schema-valid v1 (single-turn) suite ready to be filled in. */
export function newLocalSuite(partial?: Partial<Pick<TestSuite, "id" | "title" | "category" | "author" | "license">>): LocalSuite {
  const now = new Date().toISOString();
  const suite: TestSuite = {
    schemaVersion: 1,
    id: partial?.id ?? "my-suite",
    version: "0.1.0",
    title: partial?.title ?? "Untitled suite",
    summary: "Describe what this suite measures and why it matters.",
    category: partial?.category ?? "safety",
    risk: "moderate",
    license: partial?.license ?? "CC-BY-4.0",
    author: partial?.author ?? "AI4H researcher",
    tags: ["safety"],
    sourceId: LOCAL_SOURCE_ID,
    cases: [
      {
        id: "case-1",
        title: "First case",
        messages: [{ role: "user", content: "" }],
        evaluators: [{ type: "non_empty" }]
      }
    ]
  };
  return {
    localId: crypto.randomUUID(),
    suite,
    yaml: canonicalYaml(suite),
    createdAt: now,
    updatedAt: now,
    dirty: true
  };
}

/**
 * Replace a local suite's `suite` object and mark it dirty. The caller then
 * calls `canonicalize` to re-serialize + re-hash and clear the flag. The stale
 * hash is dropped so a dirty suite never carries a fingerprint that no longer
 * matches its bytes.
 */
export function withSuite(local: LocalSuite, suite: TestSuite): LocalSuite {
  return { ...local, suite, contentHash: undefined, dirty: true, updatedAt: new Date().toISOString() };
}

/**
 * Re-serialize a local suite's `suite` to canonical YAML and recompute its
 * fingerprint, clearing the dirty flag. Returns the updated `LocalSuite`.
 */
export async function canonicalize(local: LocalSuite): Promise<LocalSuite> {
  const yaml = canonicalYaml(local.suite);
  const contentHash = await hashSuiteYaml(yaml);
  return { ...local, yaml, contentHash, dirty: false, updatedAt: new Date().toISOString() };
}

/**
 * A validation check: pass/fail plus a one-line fix hint. The editor renders
 * these in the "Checks" pane (docs/SUITE_AUTHORING.md §6.2).
 */
export type Check = {
  id: string;
  label: string;
  pass: boolean;
  hint?: string;
};

export type SuiteValidation = {
  /** Structural schema errors (zod). Empty when the suite is structurally valid. */
  structural: string[];
  /** Errors against the pinned official YAML publication schema. */
  publication: string[];
  /** Identity/uniqueness checks (suite id, case ids). */
  identity: Check[];
  /** True when the structural schema passes — the suite is runnable. */
  runnable: boolean;
  /** True when structural, publication schema, and identity checks all pass. */
  publishable: boolean;
};

function humanizeZod(error: unknown): string[] {
  if (!(error instanceof Error)) return ["Suite failed structural validation."];
  // zod v3+ exposes issues on the error instance.
  const issues = (error as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
  if (!issues || issues.length === 0) return [error.message];
  return issues.map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "suite";
    return `${where}: ${issue.message}`;
  });
}

/**
 * Validate a local suite for the editor. Structural errors come from the same
 * zod schema the catalog loader uses; identity checks mirror the build's
 * duplicate-identity guards (suite id format, unique case ids).
 */
export function validateSuite(suite: TestSuite): SuiteValidation {
  let structural: string[] = [];
  let runnable = false;
  try {
    singleTurnSuiteSchema.parse(suite);
    runnable = true;
  } catch (error) {
    structural = humanizeZod(error);
  }

  const identity: Check[] = [];
  const idOk = /^[a-z0-9][a-z0-9._-]+$/.test(suite.id);
  identity.push({
    id: "suite-id",
    label: "Suite id is a valid slug",
    pass: idOk,
    hint: idOk ? undefined : "Use lowercase letters, digits, dots, dashes; start with a letter or digit."
  });

  const caseIds = suite.cases.map((c) => c.id);
  const dupCaseIds = caseIds.filter((id, i) => caseIds.indexOf(id) !== i);
  identity.push({
    id: "case-ids-unique",
    label: "Case ids are unique",
    pass: dupCaseIds.length === 0,
    hint: dupCaseIds.length ? `Duplicate case id(s): ${[...new Set(dupCaseIds)].join(", ")}` : undefined
  });

  const identityPass = identity.every((check) => check.pass);
  const publication = publicationSchemaErrors(toExportObject(suite));
  return {
    structural,
    publication,
    identity,
    runnable,
    publishable: runnable && identityPass && publication.length === 0
  };
}

/**
 * The suite object a local suite contributes to the runner. Local suites flow
 * through the existing runner unchanged (docs/SUITE_AUTHORING.md §9); the only
 * addition is a real `contentHash` so publication metadata is complete.
 */
export function runnableSuite(local: LocalSuite): TestSuite {
  return { ...local.suite, contentHash: local.contentHash || undefined };
}

/** Only saved, structurally valid drafts may enter the run flow. */
export function availableLocalSuites(locals: LocalSuite[]): TestSuite[] {
  return locals.filter((local) => !local.dirty && validateSuite(local.suite).runnable).map(runnableSuite);
}
