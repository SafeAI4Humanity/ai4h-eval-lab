# Architecture

## Trust boundaries

AI4H Eval Lab has four explicit trust boundaries:

1. **Desktop application:** signed application code maintained by AI4H.
2. **Catalog data:** declarative JSON from official or user-selected sources. It is schema-validated and never executed.
3. **Provider traffic:** prompts and responses exchanged directly between the user's device and the configured provider.
4. **Local evidence:** connections without secrets, catalog state, and up to 100 recent runs stored locally. API secrets use the operating-system credential vault.

## Front end

React and TypeScript provide the application interface and evaluation orchestration. The same interface can run in a browser during development. Browser preview intentionally keeps provider secrets in memory only.

## Desktop layer

Tauri 2 supplies the macOS and Linux shell. Rust commands bridge to the native credential manager. Tauri's HTTP client performs provider and catalog requests without browser CORS restrictions. The capability permits user-configured HTTP and HTTPS endpoints because local inference servers and third-party catalogs are core product requirements.

## Provider contract

Each provider adapter implements model discovery and generation. Responses are normalized to text, prompt-token count, and completion-token count. The runner adds target identity, timestamps, latency, suite identity, evaluator outcomes, and errors.

## Reproducibility

Suite releases are immutable. A run snapshots suite ID, semantic version, and SHA-256 content hash. Provider behavior can still change behind a stable model alias, so exported records also include provider identity, exact model ID, connection label, generation parameters, and date.

## Catalog updates

At startup, bundled suites are immediately available. Enabled remote sources are checked in the background. A failed source does not block the app. Duplicate suite versions are deduplicated, with loaded remote catalogs taking precedence over equivalent bundled starter versions.

## Deliberate limitations of the first release

- Local history currently uses browser/WebView storage rather than SQLite.
- Runs are processed sequentially to favor stable ordering and conservative rate usage.
- LLM-as-judge is intentionally omitted until judge provenance, prompt visibility, and repeatability are designed into the schema.
- App-update signing and macOS notarization require release credentials and are not enabled in source control.
