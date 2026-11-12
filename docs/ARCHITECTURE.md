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

## Fixed multi-turn execution

Schema-v2 cases contain a fixed sequence of two to eight attack stages. The runner sends one stage at a time, appends the evaluated model's actual response to the conversation history, and then sends the next declared prompt. Every stage records its prompt, raw response, timing, token counts, and evaluator outcomes. `fail_on_any_turn` makes any stage-level automatic failure visible in the aggregate case result; human and model-assisted reviews evaluate the complete transcript.

V2 suites are distributed through a separate `catalog-v2.json` source. The existing v1 catalog remains unchanged for older app releases.

## Reproducibility

Suite releases are immutable. A run snapshots suite ID, semantic version, and SHA-256 content hash. Provider behavior can still change behind a stable model alias, so exported records also include provider identity, exact model ID, connection label, generation parameters, and date.

## Catalog updates

At startup, bundled suites are immediately available. Enabled remote sources are checked in the background. A failed source does not block the app. Duplicate suite versions are deduplicated, with loaded remote catalogs taking precedence over equivalent bundled starter versions.

## Deliberate limitations of the first release

- Local history currently uses browser/WebView storage rather than SQLite.
- Runs are processed sequentially to favor stable ordering and conservative rate usage.
- Model-assisted review is provisional evidence with reviewer identity and the raw reviewing-model response preserved alongside the result.
- App-update signing and macOS notarization require release credentials and are not enabled in source control.

## Reviewing an evaluation in progress

Completed case responses in the live evidence stream expand to show the same
stored prompts, raw responses, evaluator evidence, and review controls as the
Results view. Multi-turn and agent cases expose their complete evidence once
the case finishes. Human and connected-model reviews can be saved while later
cases continue; requesting a model review does not pause evaluation requests.
A Live evaluation navigation item returns to the active run after visiting
another section.

`useEvaluationRuns` persists incoming run snapshots and reviews in one state
store. It merges reviews by result and review ID when the runner reports
progress, completion, or cancellation, preserving separately saved reviews and
the original automatic outcomes. This also preserves a model review that
returns after the evaluation completes. Saved evidence and reviews remain in
local storage after a reload; an interrupted evaluation is not automatically
resumed.

## Provider proxy routing

`providerFetch` is the shared boundary for every request in `providers.ts`.
It reads the global `ai4h.provider-proxy.v1` setting for each new request and
passes the configured address via the Tauri HTTP plugin's `proxy.all` option.
This covers both HTTP and HTTPS provider destinations, including Gemini's
separate discovery and generation paths. `appFetch` remains the transport for
non-provider resources.

An enabled proxy is fail-closed: invalid configuration, browser preview, and
proxy connection failures do not trigger a direct request. Network failures
produce a proxy-specific error; HTTP 407 reports proxy authentication failure.
The existing native diagnostic probe is skipped for proxied requests because
it would otherwise issue a separate direct GET. Cancellation remains a
cancellation rather than a proxy error. Both HTTP and HTTPS proxy servers are
accepted without disabling certificate checks.
