# Design: repeated-runs + confidence-interval reporting layer

Status: **for review** — no code written yet. Target repo: `SafeAI4Humanity/ai4h-eval-lab` (the runner). Grounded in Anthropic's [Building strong safety evaluations](https://www.anthropic.com/research/building-strong-safety-evaluations) and the current Eval Lab architecture (`ai4h.runs.v1`, `outcomePolicy: fail_on_any_turn`, settings already snapshotted into the run record at creation).

## 1. Motivation

Eval Lab currently reports a single pass/fail per case. A single run of a noisy, nondeterministic model is one sample from a distribution; presenting it as a score overclaims. Anthropic's post sets practical floors (100 items for a complex multi-turn eval, 1,000 for single-turn), requires confidence intervals on every estimate, and uses paired per-item comparisons for model-vs-model claims. Our catalogs are 2–10 cases per suite — fine as **regression checks**, too small to support "model X is safer than Y" claims unless we report uncertainty honestly.

## 2. Goals

- Turn single runs into **run groups**: N independent attempts per case, per-case pass rate + CI.
- Make CIs honest about what's random (seed, sampling) and what isn't (case identity, grader version).
- Preregister analysis plans before results come in.
- Keep grader uncertainty a separate, reported number — never folded into the model's CI.

## Non-goals

- No change to suite YAML semantics (case/turn/evaluator shapes stay; only optional additions).
- No catalog rebuild requirement from this layer (reporting/display concern in the runner app, not the published catalog contract).

## 3. Data model

A `runGroup` sits above existing run records:

```json
runGroup {
  groupId, suiteId, suiteVersion, contentHash,
  model, modelRevision,                 // modelRevision = returned immutable revision/digest per attempt, not just the requested alias
  connectionSnapshot,                     // effective reasoning effort pinned here (existing rule)
  graderVersion, rubricVersion,         // new: a CI must never mix grader/rubric versions
  analysisPlanHash, plannedN, actualN,
  cases: [{
    caseId, runs: [{
      runId, seedUsed, verdict,          // verdict = case-level, under fail_on_any_turn
      status: "scored" | "infraError",   // infra errors excluded from the denominator
      turnVerdicts, responseLength, humanReviewFlag
    }]
  }]
}
```

Preregistration block (`analysisPlan`): metric definition, planned comparisons, planned slices, improvement/regression threshold, planned N — fixed and hashed at group creation, before any scores arrive. `actualN != plannedN` is flagged in the report with a stated reason.

## 4. Statistics layer

1. **Per-case CI:** Wilson interval (handles small N and 0%/100% boundaries); Clopper–Pearson available as the exact alternative. Denominator = **scored runs only**. Denominator exclusions are reserved for genuine infrastructure failures (transport/provider errors, malformed responses, empty content *from a failed retry*). Outcomes that arise from a *valid* provider response — tool-call-only turns, stops with no final text, model-caused truncation (`finish_reason: length`) — are model outcomes, not infra failures: they count as failures — a model that consumed its output budget and produced no scorable answer must not be excluded from its own pass rate — plus a joint-success metric (answered ∧ scorable) reported alongside, so conditioning on a scorable answer is visible, not baked into the denominator.
2. **Aggregation across cases:** runs are *not i.i.d.* — case difficulty dominates and runs within a case cluster. Aggregate as the mean of case-level rates with uncertainty computed **over both levels** — a two-stage bootstrap that resamples cases, then resamples attempts within each resampled case (or a beta-binomial hierarchical model accounting for both uncertainty levels). Bootstrapping only the fixed case-level point rates is not enough: if every case has the same observed rate, it yields a zero-width aggregate interval at small N. A naive pooled binomial CI over N×cases reads far tighter than reality — this is the main trap. The aggregate method must also be boundary-aware: an empirical bootstrap is degenerate at 0%/100% — a group where every attempt passes yields exactly 100% for every replicate, zero-width regardless of N — so the default aggregate interval is parametric/Bayesian (beta-binomial with a weakly informative prior, or Clopper–Pearson on case-level rates), with bootstrap as a secondary check.
3. **Model-vs-model comparisons:** paired by case (both models on the same items), CI on the case-level rate difference via a cluster bootstrap or paired hierarchical model. Plain McNemar only when the design supplies exactly one independent binary outcome per case — pairing attempts by seed yields multiple correlated pairs from the same prompt and violates its independent-pairs assumption, and reducing each case to a single binary pair discards the repeated-run data. The UI must block any comparison where grader, settings, or prompt differ beyond the one varied variable.
4. **Power guidance:** show CI half-width per case; badge runs below the usable floor. Reference (95% Wilson, p=0.5): roughly ±26.3 pp at N=10, ±16.8 pp at N=30 — computed dynamically rather than hard-coded, so the UI states the width rather than implying precision. **Significance labels use the paired-difference interval**: say "statistically indistinguishable" only when the paired-delta CI includes zero; overlap of two marginal intervals is visualization only — with the same cases creating paired covariance, marginal overlap does not imply the difference is insignificant.
5. **Binary outcome mapping (§4.5):** verdicts are three-way (`pass` / `mostly_pass` / `fail` in `src/types.ts`), but every statistic above assumes a binary outcome per run. The mapping is fixed at preregistration time in the `analysisPlanHash`: default `mostly_pass` counts as **fail** in headline pass rates, and its share is reported as a separate statistic so it stays visible; any per-suite alternative mapping must be declared in the plan before results arrive (see open question 2).

## 5. Determinism requirements

- **Seed perturbation:** suite YAML pins one seed per case, so naive re-runs would be byte-identical and the CI fake. Per-run seed = `baseSeed + runIndex` (or omitted), recorded per run; temperature must be > 0 for runs to diverge, and is recorded.
- **Version pinning:** `graderVersion`, `rubricVersion`, the returned model revision/digest (not just the requested alias, whose behavior can change), effective reasoning effort, dates — all in the run record; if the digest changes mid-group, the group is split or rejected, so cross-revision mixing is detectable and cross-version comparisons stay blocked (effort snapshot is already required by the existing rule; this extends it to grader/rubric).

## 6. Grader uncertainty (separate track)

- Rubrics as **atomic binary criteria** — yes/no questions with explicit "what does NOT meet the criterion" clauses. Authoring/schema change, enforceable in validate as a `criteria[]` field alongside (or replacing) prose rubrics.
- Grader sees only the conversation, not design metadata.
- Grader model ≠ tested model (self-preference bias); length-bias check: report correlation between grader verdicts and response length.
- Calibration sample: humans label first (blind to grader), kappa vs. the human–human agreement baseline reported as its own statistic. If human experts disagree with each other, the construct itself is reconsidered.
- Fail loudly: a broken grader excludes the run with an explicit status; no silent scoring.

## 7. Cost control

Tiered budgets: exploratory at N=5, publishable at N≥30–100 per case, **and** a minimum independent-case-count floor for publishable groups — runs estimate stochastic variation, but N attempts on 2 cases is still 2 independent items; the badge gates on both attempt count and case count, otherwise exports are restricted to explicitly case-specific regression results. Repeated runs routed to the low-utilization GPU backend via inferwatch per-request metrics, so N×cases doesn't serialize on a busy backend.

## 8. UI / reporting

- Case card shows `78% [64–88]` instead of a single verdict.
- Category-level breakout; non-changing categories reported alongside changed ones.
- Export format additions: `metrics: {passRate, ci, method, scored, excluded}`, `analysisPlanHash`.

## 9. Rollout

- **MVP:** Wilson CI per case + exclude-from-denominator rule + seed perturbation. These three alone turn existing runs into honest numbers.
- **Phase 2:** hierarchical aggregate, McNemar/paired-delta, preregistration gate in the UI.
- **Phase 3:** grader calibration pipeline, `criteria[]` schema enforcement in the catalog validate gate.

## 10. Open questions for the reviewer

1. **Which CI method is the default** — Wilson (pragmatic, readable) vs. Clopper–Pearson (exact)? And which bootstrap flavor for the hierarchical aggregate (percentile vs. BCa)?
2. **The two-layer evaluator rule** (auto-check as supporting evidence, `human_review` as the authoritative signal): does the CI apply to the authoritative verdict only, or to both layers separately? My lean: the headline CI on the authoritative verdict, auto-check agreement reported as a secondary statistic — but this needs a decision, and some suites (bias/refusal) are human-review-only, so the "authoritative verdict" source varies per suite. Whichever source is chosen, its `mostly_pass` mapping per §4.5 must be fixed in the same analysis plan.
3. **Planned N vs. cost reality** — should the power badge block export/publishing, or only annotate? Blocking feels right for anything quoted externally.
4. **Backfill policy** for historical single-run records: treat as N=1 groups with unreportable CI, or retroactive re-runs?
5. **Paired comparisons across connection types** — the existing rule mirrors request settings across provider branches; should cross-provider comparisons be allowed at all when the effective settings can't be guaranteed identical?
