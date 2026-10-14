import { stringify } from "yaml";
import type { TestSuite } from "../types";

/**
 * Canonical YAML serialization for locally-authored suites.
 *
 * The official build hashes the exact bytes of the committed .yaml file
 * (`sha256(raw)`). A locally-authored suite is publishable when the
 * contributor commits the app's exported bytes unmodified — then the app's
 * fingerprint and the build's fingerprint are identical by construction.
 *
 * We deliberately do NOT try to match the legacy hand-authored repo style
 * (which is not reproducible by any single deterministic serializer). Instead
 * the app defines ONE deterministic serializer and pins its exact output with
 * a golden-file test, so a serializer change is deliberate and loud.
 *
 * See docs/SUITE_AUTHORING.md §5.
 */

/**
 * One fixed options block, used everywhere in the app (display, export, hash)
 * so those paths can never diverge.
 */
export const CANONICAL_YAML_OPTIONS = {
  indent: 2,
  lineWidth: 0 // never wrap long lines
} as const;

/**
 * The metadata field order a repo suite file carries. App-internal fields
 * (`sourceId`, `contentHash`) are intentionally excluded: the build computes
 * the hash and the app injects `sourceId` at load time, so neither belongs in
 * the committed file.
 */
const METADATA_KEY_ORDER = [
  "schemaVersion",
  "id",
  "version",
  "title",
  "summary",
  "category",
  "risk",
  "license",
  "author",
  "tags",
  "limitations",
  "releasedAt"
] as const;

/**
 * Build the export object in canonical field order, dropping app-internal
 * fields. Returns a plain object (not a TestSuite) because the committed file
 * has a different field set than the in-app representation.
 */
export function toExportObject(suite: TestSuite): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of METADATA_KEY_ORDER) {
    const value = (suite as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  // v3 suites carry a runner block between metadata and cases.
  if (suite.runner !== undefined) out.runner = suite.runner;
  out.cases = suite.cases;
  return out;
}

/**
 * Serialize a suite to canonical YAML bytes (with a trailing newline, matching
 * the repo convention). Deterministic: same input → same bytes.
 */
export function canonicalYaml(suite: TestSuite): string {
  return stringify(toExportObject(suite), CANONICAL_YAML_OPTIONS) + "\n";
}

/**
 * Compute the `sha256:<64-hex>` fingerprint of a suite's canonical YAML, using
 * the Web Crypto API (no Node dependency; works in the WebView and the Tauri
 * shell). Byte-identical to the build's `createHash("sha256").update(raw)`
 * over the same bytes.
 */
export async function hashSuiteYaml(yaml: string): Promise<string> {
  const bytes = new TextEncoder().encode(yaml);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Convenience: fingerprint of a suite's canonical YAML. */
export async function hashSuite(suite: TestSuite): Promise<string> {
  return hashSuiteYaml(canonicalYaml(suite));
}