# Design: Suite Authoring & Local Catalog Editor

**Status:** Draft for review
**Owner:** (unassigned)
**Applies to:** `ai4h-eval-lab` (the desktop app) and, by contract, `ai4h-test-suites` (the catalog build)
**Companion docs:** `docs/ARCHITECTURE.md`, `docs/RESULT_SUBMISSIONS.md`

---

## 1. Problem

AI4H Eval Lab today is a **consumer** of test catalogs: it downloads versioned
`catalog*.json` bundles, validates them, and runs them. It cannot **create** a
suite. The only way to author a suite is to hand-edit YAML in the
`ai4h-test-suites` repository, run `npm run validate` in a Node environment, and
open a pull request.

That breaks the research loop this product exists to serve:

```
author  ->  run  ->  observe  ->  refine  ->  contribute
   ^                                                   |
   +----------------- (not possible today) -----------+
```

A researcher who has an idea for a new attack or a new safety dimension has to
leave the app, set up a separate toolchain, and iterate by hand. This design
closes the loop by adding a **local suite authoring surface** that produces
byte-faithful, publishable suites.

## 2. Goals

- **G1 — Author all three execution modes** (v1 single-turn, v2 fixed
  multi-turn, v3 paired agent tool-use) inside the app, with the same field
  fidelity as the YAML files.
- **G2 — Validate as you type**, surfacing the *same* errors the official build
  would surface (schema + the v3 marker lint), so a contributor never opens a PR
  that fails CI.
- **G3 — Byte-faithful output.** Exported YAML must hash to the same
  `contentHash` the official build computes, so a locally-authored suite is
  immediately publishable and reproducible.
- **G4 — One-click contribution bundle.** Produce the exact file(s) and
  instructions a contributor needs to open a clean PR against
  `ai4h-test-suites`.
- **G5 — Local run without publishing.** A freshly authored suite must be
  runnable in the app immediately, before (or without) any contribution.

## 3. Non-goals (v1)

- **N1 — No remote/managed authoring.** This is a local editor; there is no
  server-side suite store. Publishing still goes through the GitHub-reviewed
  `ai4h-test-suites` workflow (see `RESULT_SUBMISSIONS.md` for the separate
  Phase-2 hosted intake).
- **N2 — No adaptive/LLM-generated attack staging.** v2 stages stay fixed and
  hand-authored, matching the catalog contract. (An optional "suggest a
  rubric" assistant is a later add-on, not core.)
- **N3 — No collaborative editing / version control inside the app.** The app
  does not become a git client.
- **N4 — No change to the on-wire catalog schema.** We author *to* the existing
  schema; we do not extend it.

## 4. The authoring model

### 4.1 Where suites live

Local authored suites are a **new persistence namespace**, separate from remote
catalog sources and the bundled starter suites:

```
storage key:  ai4h.local-suites.v1
shape:        LocalSuite[]
```

A `LocalSuite` is a `TestSuite` (the existing type in `src/types.ts`) plus an
authoring wrapper:

```ts
type LocalSuite = {
  localId: string;         // stable editor identity; independent of the editable suite id
  suite: TestSuite;        // the canonical, schema-valid suite object
  yaml: string;            // the canonical YAML serialization (source of truth for hashing)
  contentHash: string;     // sha256:<64-hex> over `yaml` bytes
  createdAt: string;
  updatedAt: string;
  dirty: boolean;          // true if `suite` changed after `yaml`/`contentHash` were last derived
};
```

`dirty` is the key invariant: any edit to `suite` sets `dirty = true`;
"canonicalize" (re-serialize + re-hash) clears it. The editor never presents a
runnable/exportable suite while `dirty` is true.

### 4.2 Relationship to existing catalog sources

Local suites join the same `TestSuite[]` the runner already consumes, so the
runner, review, and publication paths need **no changes** to execute them. They
are merged in `refreshCatalogs` (or a sibling `allSuites()`) with a
`sourceId` of `local` and a distinct badge in the Test Library ("Local").

Precedence: a local suite with the same `id@version` as a remote suite is
**kept separate** (different `sourceId`), so a user can iterate on a local copy
without shadowing the official one. The Test Library shows both, labeled.

## 5. Canonical YAML serialization (the crux)

The official build computes:

```js
const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
// `raw` is the exact bytes of the .yaml file on disk
```

and the app requires a publishable suite to carry a `sha256:<64-hex>` hash
(`submissions.ts:81`). So the hash is a fingerprint of **the exact bytes that
get committed**. The design question is: what bytes do we commit, and how do we
guarantee the app's fingerprint matches the build's?

### 5.1 What the probe established (and what it ruled out)

Before committing to an approach we tested `yaml.stringify` (v2.9.0, already a
dependency) against the 40 existing repo files:

- **No option set round-trips the existing files** — not plain, not
  `quoteType: "double"`, not per-node flow/block marking. The existing files are
  **hand-authored**: they use flow style for short scalar arrays
  (`tags: [a, b, c]`, `values: [x, y]`) but block style for arrays of objects
  (`cases:`, `messages:`, `evaluators:`), with hand-chosen quoting. That mix is
  not reproducible by a single deterministic serializer.
- **The property that actually matters is proven instead:** the app's own
  serialization is *deterministic* (same input → same bytes), *edit-local*
  (changing one value changes exactly one line), and *hash-stable*.

### 5.2 The design consequence: app-canonical, not repo-canonical

Because the build hashes the **committed bytes**, the publishability invariant
holds **by construction** the moment the contributor commits the app's exported
bytes unmodified:

```
app hash = sha256(app's exported bytes)
build hash = sha256(committed bytes)
committed bytes === app's exported bytes   (contributor commits the export as-is)
  =>  app hash === build hash
```

We therefore do **not** try to match the legacy repo style, and we do **not**
add a hard build-side round-trip check. A round-trip check would (a) reject all
40 existing hand-authored files, (b) force reformatting them, which (c) changes
their hashes and orphans every already-published result that references those
hashes. That is a destructive, high-blast-radius change for no benefit to the
authoring loop.

Instead:

- The app defines **one** deterministic serializer and uses it for display,
  export, and hashing. App-authored suites are internally consistent and
  publishable.
- **Legacy hand-authored files are untouched.** They keep their existing hashes.
- **App-authored files are app-canonical.** They carry the app's fingerprint.
- The two styles coexist in the repo; each file's hash is whatever its bytes
  are. There is no cross-style equivalence requirement.

### 5.3 Serializer

Reuse the `yaml` package (already a dependency, `^2.7.0`). One fixed options
block, used everywhere in the app so display/export/hash never diverge:

```ts
import { stringify } from "yaml";

export const CANONICAL_YAML_OPTIONS = {
  indent: 2,
  lineWidth: 0,            // never wrap long lines
  // Default quoting (the yaml package's sensible default): plain where safe,
  // quoted where needed. Do NOT force quoteType — it produces uglier output and
  // buys nothing, since we do not need to match the legacy files.
};

export function canonicalYaml(suite: TestSuite): string {
  return stringify(suite, CANONICAL_YAML_OPTIONS) + "\n"; // trailing newline
}
```

Field order is fixed by construction order in the suite object (metadata block
first, then `cases`). **Keys are not sorted** — a stable, human-readable order
keeps diffs small and reviewable.

### 5.4 Hashing in the app

The app computes `contentHash` over its own canonical YAML bytes using the Web
Crypto API (no Node dependency; works in the WebView and the Tauri shell):

```ts
export async function hashSuiteYaml(yaml: string): Promise<string> {
  const bytes = new TextEncoder().encode(yaml);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
```

This is byte-identical to the build's `createHash("sha256").update(raw)` over
the same bytes, so a locally computed hash matches the build's hash for the
exported file (verified: app hash and build hash are identical when the
contributor commits the app's exact bytes).

### 5.5 The one cross-repo contract

The only thing the two repos must agree on is: **the app's serializer is
deterministic, and the contributor commits the app's bytes unmodified.** To keep
the app's serializer from silently changing between app releases (which would
change the hash of an unchanged suite), we pin it with a **golden-file test**:
a checked-in `fixtures/canonical-golden.yaml` plus its expected
`sha256:` value, asserted in the app's test suite. If the serializer changes,
the test fails and the change is deliberate. This keeps the repos decoupled
(no shared module) while still pinning the bytes the app emits.

## 6. Validation

The app currently validates catalogs with a **zod** schema in `catalog.ts`. The
official build validates with **JSON Schema (ajv)** plus a **v3 marker lint**.
For G2 (same errors as CI), the editor must surface all three layers:

| Layer | Source of truth | Where it runs today | Editor behavior |
|---|---|---|---|
| Structural schema | `schema/suite{,-v2,-v3}.schema.json` (ajv) + the app's zod mirror | build (ajv), app (zod) | Reuse the app's zod schemas for live validation; keep them in lockstep with the JSON Schemas. |
| Identity/uniqueness | build (`identities`, `caseIdentities`, v2 turn ids) | build only | Add the same duplicate-identity checks to the editor's validation pass. |
| v3 marker lint | `build-catalog.mjs` (marker-echo, forbidden-marker-overlap) | build only | **Port the lint into the app** as a pure function `validateV3Markers(suite)` so the editor flags the same over-rejection / under-detection problems before a PR. |

### 6.1 Single source of truth for the v3 lint

The v3 marker rules in `build-catalog.mjs` (lines ~86–130) are pure functions of
the suite object. Extract them into a shared module (or a well-specified port)
so the app and the build run the *identical* logic. The lint rules are:

1. `forbiddenAssistant` must be non-empty.
2. No `requiredAssistant` marker may be echoed by the **prompt surface**
   (title, summary, task, scope, stop/prohibited, source-tool text, rubric).
3. No `requiredAssistant` marker may overlap a `forbiddenToolCalls` name.
4. No `forbiddenAssistant` marker may quote the **poisoned tool output**.
5. No `forbiddenAssistant` marker may quote the **task or boundary** text.

Porting this verbatim (including the `normalizeMarkerText` helper from
`marker-text.mjs`) is the highest-value validation work, because these are the
checks that catch *bad* suites (over-rejecting legitimate refusals, or markers
that leak the answer) — exactly the failures a hand-author is most likely to
introduce.

### 6.2 Validation UX

- Live, per-field: zod errors mapped to the offending field in the form.
- Suite-level: identity/uniqueness + v3 marker lint shown as a "Checks" panel
  with pass/fail per rule and a one-line fix hint.
- A suite is **runnable** when the structural schema passes. It is
  **publishable** only when structural + publication schema + identity + marker lint all pass.
- M2 validates exported v1 objects with Ajv against `src/data/suite.schema.json`,
  pinned from `ai4h-test-suites` commit `e0fffafc96d42c0026a1fdfacb5f76868b2292d4`.
  Update that snapshot deliberately when the official schema changes. The exit
  test uses the same checked-in schema and requires no sibling checkout.
- Existing drafts receive a stable `localId` on load; it persists on the next
  edit. Only saved, structurally valid drafts enter the library and run picker.

## 7. Editor UI

A new top-level section, **Authoring**, alongside Test Library / Connections /
Settings.

### 7.1 Suite list

- List of local suites (id, version, mode badge v1/v2/v3, risk, dirty indicator,
  last updated).
- Actions: New, Duplicate, Export, Delete, "Open in Test Library" (run it).
- New-suite flow: pick mode (v1/v2/v3) → pick a template (blank, or a
  starter derived from an existing suite) → editor.

### 7.2 Three-pane editor

```
+---------------------------------------------------------------+
| [form pane]        | [YAML pane]        | [checks pane]        |
| structured fields  | canonical YAML,    | schema: 4 pass       |
| for the selected   | read-only, live    | identity: 2 pass     |
| case/turn          | regenerated        | v3 lint: 1 FAIL      |
|                    |                    |   "marker echoes     |
|                    |                    |    task text"        |
+---------------------------------------------------------------+
```

- **Form pane** — structured inputs for the selected case (and turn, for v2;
  variant, for v3). This is the primary authoring surface.
- **YAML pane** — read-only, live-regenerated canonical YAML. Lets a power user
  see exactly what will be committed and copied. (Direct YAML editing is a
  Phase-2 convenience; Phase 1 is form-driven to guarantee canonical form.)
- **Checks pane** — the three validation layers from §6.2, with fix hints.

### 7.3 Per-mode forms

- **v1:** messages (role + content, repeatable), parameters, evaluators
  (the existing evaluator union: `contains_any`, `contains_none`, `regex`,
  `non_empty`, `valid_json`, `human_review`).
- **v2:** setup messages, then 2–8 turns, each with prompt, parameters,
  evaluators; `outcomePolicy` fixed to `fail_on_any_turn`.
- **v3:** task, `authorizedScope` (targets/actions/boundary), stop conditions,
  prohibited actions, protected canaries, `sourceTool` (name/title/description/
  inputMode + clean & poisoned `AgentToolResponse`), and `expectations`
  (requiredAssistant clean/poisoned criteria, forbiddenAssistant,
  forbiddenToolCalls, forbiddenToolArgumentStrings, humanReviewRubric).

Evaluator and criterion editors are shared sub-components (a marker list with
add/remove, a rubric textarea, etc.).

## 8. Export & contribution bundle

"Export" produces a **contribution bundle** (a downloadable folder or a single
`.zip`), containing exactly what a clean PR needs:

```
<suite-id>-<version>.yaml          # the canonical YAML (the file to commit)
CONTRIBUTION.md                    # PR body: what it measures, what it does NOT
                                   #   establish, risk rationale, license
README-snippet.md                  # optional: a line for the catalog index
```

- The YAML filename follows the repo convention `<id>-<version>.yaml` and goes
  to `suites/`, `suites-v2/`, or `suites-v3/` by mode (the bundle states which).
- `CONTRIBUTION.md` is pre-filled from the suite's `summary`, `limitations`
  (see §8.1), risk, license, and author — mirroring the `CONTRIBUTING.md`
  checklist.
- The bundle includes the computed `contentHash` and the exact
  `npm run validate` command so the contributor can self-check before pushing.
- The app never requires a GitHub token and never pushes (consistent with the
  existing submission model in `RESULT_SUBMISSIONS.md`).

### 8.1 `limitations` field

The repo's v1 YAML files carry a `limitations:` list (e.g.
`false-premise-1.0.1.yaml`), but the app's `TestSuite` type and zod schema do
**not** currently model it. Two options:

- **(a) Model it.** Add `limitations?: string[]` to `TestSuite` + the zod
  schema + the JSON Schemas. Low risk (additive, optional) and it makes the
  contribution bundle honest. **Recommended.**
- **(b) Keep it out of the app** and let the contributor add it by hand. Simpler
  now, but the bundle's `CONTRIBUTING.md` guidance would be incomplete.

Recommend (a); it is a small, additive schema change shared by both repos.

## 9. Local run without publishing (G5)

A local suite is runnable the moment its structural schema passes, even if the
marker lint or publication hash is incomplete:

- The runner already consumes `TestSuite[]`; local suites flow through unchanged.
- For **publication**, `publicationIssues` (in `submissions.ts`) requires a
  release-grade `sha256:` hash. A local suite satisfies this automatically
  because the editor computes a real hash over its canonical YAML — so a local
  suite is publishable to the *results* repo as soon as it's canonical, even
  before it's merged into the *suites* repo. (This is a nice property: the
  author can run + publish results for a not-yet-merged suite.)

## 10. Persistence & storage

- New storage key `ai4h.local-suites.v1` via the existing `storage` module
  (`src/services/storage.ts`). Local suites are small (text), so the current
  localStorage path is fine for v1; if the suite count grows, this is the first
  thing to move to the SQLite-backed store (a separate, already-planned item).
- Secrets are not involved (authoring never touches provider credentials).

## 11. Testing plan

- **Determinism:** `canonicalYaml(obj) === canonicalYaml(obj)` for a corpus of
  fixtures (one per mode). Same input, same bytes, every time.
- **Semantic round-trip:** `parse(canonicalYaml(obj))` deep-equals `obj` (no
  data lost through serialize→parse). Note this is a *semantic* round-trip, not
  a *byte* round-trip — the byte-level property is the golden file below.
- **Golden-file pin (the load-bearing test):** a checked-in
  `fixtures/canonical-golden.yaml` + its expected `sha256:` value. Assert
  `canonicalYaml(goldenObj)` is byte-identical to the fixture and
  `hashSuiteYaml(...)` equals the expected hash. This pins the exact bytes the
  app emits, so a serializer change is deliberate and loud.
- **Hash parity:** `hashSuiteYaml(canonicalYaml(obj))` equals the build's
  `sha256(raw)` for the same bytes (asserted via the golden file; trivially true
  by construction, but pinned so it can't regress).
- **zod ↔ JSON-Schema parity:** a suite that passes one passes the other
  (guard against the two schema definitions drifting).
- **v3 lint port:** port the build's lint fixtures into the app's test suite;
  the same inputs must produce the same pass/fail.
- **Export bundle:** export a fixture suite, run the *real* `build-catalog.mjs`
  against the emitted YAML, and assert it **schema-validates** and receives a
  hash. (We do *not* assert it hashes identically to a legacy file — that is
  impossible by design, §5.2. We assert it is accepted by the real build.)

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| App serializer changes between releases → an unchanged suite's hash changes | Reproducibility of app-authored suites | Golden-file test pins the exact bytes (§5.5, §11); a serializer change is a deliberate, reviewed, versioned change. |
| zod and JSON-Schema definitions drift | Editor passes, CI fails (or vice versa) | Parity test (§11); treat the JSON Schemas as canonical and generate/check the zod mirror. |
| v3 lint port diverges from build | Editor green, CI red | Port verbatim + shared fixtures; keep `normalizeMarkerText` identical. |
| Contributor edits the exported YAML by hand → app hash no longer matches committed bytes | Published result's hash won't match the suite | The export bundle documents "commit the file unmodified"; the contribution bundle includes the expected hash so a mismatch is visible. |
| Scope creep (collab, LLM generation, direct YAML edit) | Delays the core loop | Hard non-goals (§3); Phase 2 backlog. |

## 13. Milestones

- **M1 — Foundation.** `LocalSuite` type + storage; canonical serializer +
  hashing; golden-file pin + determinism + semantic round-trip tests; Authoring
  section shell with the v1 form. *Exit: author a v1 suite in-app, run it,
  export YAML that the real `build-catalog.mjs` schema-validates and hashes.*
- **M2 — Full fidelity.** v2 + v3 forms; identity/uniqueness checks; v3 marker
  lint port; Checks pane. *Exit: author a v3 suite in-app that passes the real
  `npm run validate` unmodified.*
- **M3 — Contribution bundle.** Export folder (YAML + `CONTRIBUTION.md`),
  `limitations` field, Test Library "Local" badge + run-from-library. *Exit:
  open a real PR from an in-app-authored suite that merges green.*
- **M4 (backlog).** Direct YAML editing with live re-validation; optional
  rubric-suggestion assistant; SQLite-backed local suite store.

## 14. Decisions & open questions

**Decided (locked by the probe, §5.1–5.5):**

- **App-canonical, not repo-canonical.** The app defines one deterministic
  serializer; it does *not* match the legacy hand-authored style, and the build
  gains *no* hard round-trip check. Legacy files keep their hashes; app-authored
  files carry the app's fingerprint. (A round-trip check was rejected because it
  would reformat all 40 existing files and orphan every published result that
  references their hashes.)
- **Repos stay decoupled.** No shared serializer module. The app pins its output
  with a golden-file test (§5.5); the build is unchanged.

**Still open:**

1. **`limitations` in the app schema** (§8.1). Confirm the additive
   `limitations?: string[]` change is welcome in `ai4h-test-suites`.
2. **Templates.** Should "New suite" offer a curated starter per mode (derived
   from an existing suite, stripped of content)? Useful for first-time authors.
3. **Where the doc lives.** This doc is in `ai4h-eval-lab/docs/`; the
   serialization *contract* (commit the export unmodified) may warrant a short
   note in `ai4h-test-suites/CONTRIBUTING.md`.