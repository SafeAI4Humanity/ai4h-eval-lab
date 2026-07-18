# Result submission design

AI4H Eval Lab keeps results local by default. Any future submission flow must be explicit, previewable, and separate from normal evaluation execution.

## Recommended rollout

### Phase 1: GitHub-reviewed submissions

Create a public `ai4h-evaluation-results` repository with:

- a versioned JSON Schema for submission envelopes;
- a `submissions/pending/` directory for pull requests;
- CI that validates schemas, suite hashes, model identity, timestamps, and duplicate result hashes;
- an issue or pull-request template that requires methodology and consent statements;
- maintainer review before moving results into `submissions/accepted/`;
- a generated, read-only catalog consumed by the AI4H website.

The app should initially provide **Prepare submission bundle** and **Open contribution instructions** actions. It should not request a GitHub token or upload automatically. Contributors can inspect the JSON and submit it through GitHub's normal pull-request workflow.

### Phase 2: Hosted intake service

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
    "version": "0.1.0"
  },
  "consent": {
    "publicRelease": true,
    "includeRawResponses": true,
    "includeEnvironmentDetails": false
  },
  "provenance": {
    "submitter": "optional public name",
    "notes": "optional methodology notes"
  },
  "run": {}
}
```

The bundle should include exact provider and model IDs, suite versions and hashes, parameters, timestamps, evaluator outcomes, and—only with separate consent—raw model responses. Hardware details, usernames, hostnames, connection URLs, local file paths, API keys, and diagnostic logs should be excluded.

## Trust and moderation

Community results are evidence submissions, not automatically verified findings. The public site should distinguish:

- submitted and unreviewed;
- schema-validated;
- reproduced independently;
- accepted for publication;
- withdrawn or superseded.

Deduplication should use a canonical hash over the suite snapshot, provider/model identity, parameters, and results. A hosted service should also enforce payload limits, rate limits, content scanning, and a documented removal process.
