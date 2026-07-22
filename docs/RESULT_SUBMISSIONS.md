# Result submission workflow

AI4H Eval Lab keeps results local by default. Public submission is explicit, previewable, and separate from normal evaluation export.

## Phase 1: GitHub-reviewed submissions

The **Prepare publication** action creates a schema-versioned bundle for the public `ai4h-evaluation-results` repository. It requires separate confirmation for public release and for inspection of raw responses and review notes.

The bundle includes:

- exact provider and model identifiers;
- released suite IDs, semantic versions, categories, risk labels, and SHA-256 content hashes;
- original prompts, raw responses, evaluator outcomes, timing, and token counts when available;
- saved human and model-assisted review evidence;
- optional public submitter identity and methodology notes;
- explicit public-release, raw-response, and review consent.

The bundle excludes connection URLs, connection IDs, local connection names, credentials, hostnames, local paths, diagnostics, and unrelated settings. Request errors retain their status while local diagnostic details are replaced with a public-safe explanation.

Only completed runs with original test messages and release-grade suite hashes can be prepared. Older offline runs using placeholder bundle hashes must be rerun after refreshing the official catalog.

Contributors inspect the downloaded JSON and add it to `submissions/YYYY/MM/<submissionId>.json` through a normal GitHub pull request. The app never requests a GitHub token or uploads automatically.

Repository CI validates the schema, official suite metadata, hashes, timestamps, model identities, duplicates, file path, and prohibited local metadata. Merged submissions are accepted evidence. A separate generator publishes model-card summaries and full case evidence for the AI4H website.

## Phase 2: Hosted intake service

Replace the manual contribution step with an optional HTTPS endpoint hosted on AWS or GCP:

1. The desktop app shows a complete submission preview and records explicit consent.
2. The API validates size and schema before accepting a payload.
3. Raw submissions enter quarantined object storage, not the public website.
4. A queue triggers validation, deduplication, abuse checks, and suite-hash verification.
5. Maintainers review candidates in a small moderation interface.
6. Accepted, normalized records are published to the public results catalog and website.

This can be implemented with API Gateway + Lambda + S3 + SQS on AWS, or API Gateway/Cloud Run + Cloud Storage + Pub/Sub on GCP. No provider API keys or application diagnostics should ever be part of a result submission.

## Submission envelope

```json
{
  "schemaVersion": 1,
  "submissionId": "uuid",
  "submittedAt": "ISO-8601 timestamp",
  "app": {
    "name": "AI4H Eval Lab",
    "version": "0.5.0"
  },
  "consent": {
    "publicRelease": true,
    "includeRawResponses": true,
    "includeReviews": true
  },
  "provenance": {
    "submitter": "optional public name",
    "notes": "optional methodology notes"
  },
  "run": {}
}
```

Suite snapshots also contain the category and risk label needed to reproduce dimension-level website cards without depending on a mutable catalog lookup.

## Trust and moderation

Community results are evidence submissions, not vendor-authored model cards or universal safety certifications. The public site distinguishes automatic indicators, human verdicts, and provisional model-assisted reviews rather than blending them into a composite score.

Publication state should distinguish:

- submitted and unreviewed;
- schema-validated;
- reproduced independently;
- accepted for publication;
- withdrawn or superseded.

Deduplication should use a canonical hash over the suite snapshot, provider/model identity, parameters, and results. A hosted service should also enforce payload limits, rate limits, content scanning, and a documented removal process.
