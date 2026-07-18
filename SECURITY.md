# Security policy

Please report vulnerabilities privately to **info@ai-4-h.org**. Do not include active credentials, private model output, or sensitive test material in a public issue.

## Credential handling

Desktop builds store provider keys in the native credential manager under service `org.ai4h.eval-lab`. Keys are excluded from connection metadata, test suites, logs, run results, and exports. Browser development preview holds keys in process memory only and loses them on reload.

## Third-party catalogs

Catalog URLs are user-authorized network sources. Their content is untrusted data and must pass the versioned suite schema. The application does not execute downloaded JavaScript, shell commands, native libraries, templates, or evaluator plugins.

Catalog authors can still supply misleading prompts, rubrics, licenses, or conclusions. Users should review a third-party source before relying on it and clearly identify that source in published work.

## Network scope

The desktop HTTP capability permits HTTP and HTTPS requests because users may connect to local network model servers and arbitrary catalog sources. The app does not expose a remote control interface. Requests occur only during catalog refreshes, connection tests, or evaluations initiated through the UI.

## Supported versions

Security fixes are provided for the newest released version. The project is pre-1.0; interfaces may change while preserving exported evidence whenever feasible.
