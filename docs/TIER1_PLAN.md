# Tier 1 Build Plan

Tier 1 turns the app from a *consumer* of published suites into a **self-contained
research instrument**: you can author a suite, run it, know what it cost, and run
it fast. Three features, in dependency order.

```
M1 foundation ──► M2 v1 authoring ──► M3 v2/v3 authoring ──► M4 contribution bundle
      │
      └──────────────────────────────────────────────────────────────────────►
                                              (independent track)
                                     cost accounting ──► concurrency
```

- **Suite authoring** is the spine (M1–M4). It's the highest-leverage feature:
  it closes the loop from "read published results" to "run my own test."
- **Cost accounting** is independent and small; it's a prerequisite for safe
  concurrency (you need to know the blast radius of a run before you parallelize it).
- **Concurrency** is last because it multiplies spend and rate-limit pressure —
  you only want it once cost accounting is visible.

---

## Feature A — Suite authoring (the spine)

Design: `docs/SUITE_AUTHORING.md`.

### M1 — Foundation ✅ (done)
- `src/services/canonical.ts` — `canonicalYaml`, `toExportObject`, `hashSuiteYaml`,
  `hashSuite`, `CANONICAL_YAML_OPTIONS`.
- `src/services/canonical.golden.ts` — the golden suite object.
- `src/services/__fixtures__/canonical-golden.yaml` + `.hash` — pinned bytes.
- `src/services/canonical.test.ts` — determinism, semantic round-trip, golden-byte
  pin, hash pin, app-internal-field stripping.
- `src/types.ts` — `limitations?: string[]` added to `TestSuite`.
- `src/services/catalog.ts` — `limitations` added to the zod metadata schema.
- `scripts/gen-golden.mjs` — regenerates the fixture from the real module.
- `scripts/verify-e2e.mjs` — proves the app's export passes the **real** build's
  ajv schema and that build-hash === app-hash.

**Verified:** 55/55 tests pass; `verify-e2e.mjs` → `SCHEMA VALIDATION PASSED` +
`HASH PARITY PASSED` against `ai4h-test-suites`.

### M2 — v1 authoring UI
- `LocalSuite` storage (`ai4h.local-suites.v1`) in `storage.ts`.
- Authoring section shell in `App.tsx` (new nav item).
- v1 form: metadata fields + repeatable cases (messages, parameters, evaluators).
- Live structural validation (zod) + a "Checks" pane.
- "Run this suite" → feeds the existing runner (local suites flow through unchanged).
- "Export" → downloads the canonical YAML + computed hash.
- **Exit:** author a v1 suite in-app, run it, export YAML the real build accepts.

### M3 — v2 + v3 authoring
- v2 form (setup + 2–8 turns) and v3 form (task, scope, canaries, sourceTool,
  expectations).
- Identity/uniqueness checks (suite id, case id, turn id).
- **Port the v3 marker lint** (`check-v3-markers.mjs` / `marker-text.mjs`) verbatim
  into the app so the editor surfaces the same errors as CI.
- **Exit:** author a v3 suite in-app that passes the real `npm run validate`.

### M4 — Contribution bundle
- Export folder: `<id>-<version>.yaml` + `CONTRIBUTION.md` (pre-filled) + expected
  hash + the exact `npm run validate` command.
- Test Library "Local" badge + run-from-library.
- **Exit:** open a real PR from an in-app-authored suite that merges green.

### M5 (backlog)
- Direct YAML editing with live re-validation.
- Optional rubric-suggestion assistant.
- SQLite-backed local suite store.

---

## Feature B — Cost & token accounting

Small, independent, and a prerequisite for Feature C.

- **Price table** (`src/services/pricing.ts`): per-provider, per-model
  input/output token prices (USD per 1M tokens). Ollama/local = $0. Unknown model
  = $0 with a "price unknown" flag rather than a guess.
- **Accumulate at the source.** `runner.ts` and `agentRunner.ts` already capture
  `promptTokens`/`completionTokens` per turn/variant. Add a `costUsd` field to
  `TurnResult`, `AgentVariantResult`, `CaseResult`, and an aggregate to
  `EvaluationRun`.
- **Surface it.** Results view shows per-case and per-run cost; the run summary
  shows total. A run that has unknown prices shows a warning, not a fake total.
- **Exit:** a completed run reports a total cost (or an explicit "unknown" where
  prices are missing), per case and per run.

---

## Feature C — Configurable concurrency

Last, because it multiplies spend and rate-limit pressure.

- **Per-connection concurrency** setting (default 1 = today's behavior).
- **Per-provider rate limiting** (respect 429 + `Retry-After`; back off).
- **Run-level budget guard** (uses Feature B): optional max-cost cap that pauses
  the run and asks before continuing.
- **Exit:** a run of N cases × M targets can be parallelized per-connection
  without hammering a provider, and stops cleanly if it would exceed a cost cap.

---

## Cross-cutting

- **zod ↔ JSON-Schema parity test** (Feature A, M2): a suite that passes the app's
  zod passes the build's ajv and vice versa. Guards against the two schema
  definitions drifting. (Note: the current zod `evaluatorSchema` models only 6 of
  the 8 evaluator types in `types.ts` — `forbidden_tool_calls`,
  `forbidden_tool_arguments`, `scope_adherence` are missing. Fix as part of M2.)
- **No composite safety score.** Evidence-first is deliberate; cost is a
  *resource* metric, not a safety metric.
- **No credentials in output.** Authoring and cost accounting never touch provider
  secrets.