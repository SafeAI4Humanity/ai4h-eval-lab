import type { ProviderProxySettings } from "./providerProxy";
import type { CatalogSource, Connection, EvaluationRun, LocalSuite } from "../types";

export type InterfaceScale = "default" | "comfortable" | "large" | "extra-large";

const keys = {
  connections: "ai4h.connections.v1",
  sources: "ai4h.sources.v1",
  runs: "ai4h.runs.v1",
  localSuites: "ai4h.local-suites.v1",
  providerProxy: "ai4h.provider-proxy.v1",
  providerCleanup: "ai4h.provider-proxy-cleanup.v1",
  interfaceScale: "ai4h.interface-scale.v1"
};

const interfaceScales: InterfaceScale[] = ["default", "comfortable", "large", "extra-large"];

const PROXY_SECRET_ID = "provider-proxy";

// Persisted proxy config references the vault entry by versioned identifier, so a
// reader resolves a coherent (config, credential) pair: a published version's
// credential never changes afterwards.
type StoredProxyConfig = {
  enabled: boolean;
  url: string;
  secretVersion: number;
  hasSecret: boolean;
};

function proxySecretId(version: number): string {
  return `${PROXY_SECRET_ID}:${version}`;
}

const defaultConnections: Connection[] = [
  {
    id: "ollama-local",
    name: "Local Ollama",
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    enabled: true,
    status: "untested"
  }
];

const defaultSources: CatalogSource[] = [
  {
    id: "ai4h-official",
    name: "AI4H Official Catalog",
    url: "https://github.com/SafeAI4Humanity/ai4h-test-suites/releases/latest/download/catalog.json",
    official: true,
    enabled: true
  },
  {
    id: "ai4h-official-v2",
    name: "AI4H Multi-turn Catalog",
    url: "https://github.com/SafeAI4Humanity/ai4h-test-suites/releases/latest/download/catalog-v2.json",
    official: true,
    enabled: true
  },
  {
    id: "ai4h-official-v3",
    name: "AI4H Agent Tool-use Catalog",
    url: "https://github.com/SafeAI4Humanity/ai4h-test-suites/releases/latest/download/catalog-v3.json",
    official: true,
    enabled: true
  }
];

function readSources(): CatalogSource[] {
  const saved = read<CatalogSource[]>(keys.sources, []);
  const byId = new Map(saved.map((source) => [source.id, source]));
  return [...saved, ...defaultSources.filter((source) => !byId.has(source.id))];
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getProviderProxy: async (): Promise<ProviderProxySettings> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const saved = read<Partial<StoredProxyConfig> & { key?: string }>(keys.providerProxy, {});
      const config = { enabled: Boolean(saved.enabled), url: saved.url ?? "" };
      if (saved.key) {
        // Migrate entries persisted before the key lived in the secret storage boundary.
        await setSecret(proxySecretId(1), saved.key);
        write(keys.providerProxy, { ...config, secretVersion: 1, hasSecret: true });
        return { ...config, key: saved.key };
      }
      const version = saved.secretVersion ?? 0;
      // Versions without a credential — fresh installs (version 0) and keyless
      // saves — must never touch the vault, so a locked keychain cannot break
      // local providers that need no secret or the UI's recovery path.
      if (version === 0 || saved.hasSecret === false) return { ...config, key: "" };
      const key = await getSecret(proxySecretId(version));
      // The awaited lookup can span a concurrent save. Re-read after it: if the
      // version changed during the await, the snapshot is stale, so retry until a
      // fetch completes for a version that stayed stable — guaranteeing the pair
      // returned belongs to one version.
      const after = read<Partial<StoredProxyConfig>>(keys.providerProxy, {});
      if ((after.secretVersion ?? 0) === version) return { ...config, key };
    }
    const saved = read<Partial<StoredProxyConfig>>(keys.providerProxy, {});
    const version = saved.secretVersion ?? 0;
    if (version === 0 || saved.hasSecret === false) {
      return { enabled: Boolean(saved.enabled), url: saved.url ?? "", key: "" };
    }
    return { enabled: Boolean(saved.enabled), url: saved.url ?? "", key: await getSecret(proxySecretId(version)) };
  },
  setProviderProxy: async (value: ProviderProxySettings): Promise<void> => {
    const key = value.key ?? "";
    const saved = read<Partial<StoredProxyConfig>>(keys.providerProxy, {});
    const previousVersion = saved.secretVersion ?? 0;
    const version = previousVersion + 1;
    const config = { enabled: value.enabled, url: value.url, secretVersion: version, hasSecret: Boolean(key) };
    // Commit the credential for the new version first, then publish the matching
    // config in the same synchronous continuation. The persisted entry references
    // this exact version, and a published version's credential never changes, so
    // readers always observe a coherent pair. Nothing is persisted before the
    // credential is ready, so a rejected vault write leaves the stored pair
    // coherent instead of a half-committed state.
    if (key) await setSecret(proxySecretId(version), key);
    write(keys.providerProxy, config);
    if (previousVersion > 0) {
      // Post-commit cleanup of the superseded entry is best-effort: the new pair
      // is already committed, so a rejected keychain delete must not report the
      // save as failed. A transient failure is recorded for a later save to
      // retry — later saves would otherwise only delete their own immediately
      // preceding version, leaving the failed entry in the vault forever.
      const storedPending = read<string[]>(keys.providerCleanup, []);
      const pending = new Set(storedPending);
      const attemptCleanup = async (id: string) => {
        try {
          await deleteSecret(id);
          pending.delete(id);
        } catch {
          pending.add(id);
        }
      };
      await attemptCleanup(proxySecretId(previousVersion));
      for (const id of [...pending]) await attemptCleanup(id);
      // Persist whenever membership differs, not just when the size changes: a
      // successful retry plus a fresh failure can swap an entry while keeping the
      // same size (e.g. [v1] becomes [v2]), and a length-only check would skip the
      // write and forget the newly failed id forever.
      if (pending.size !== storedPending.length || [...pending].some((id) => !storedPending.includes(id))) write(keys.providerCleanup, [...pending]);
    }
  },
  getConnections: () => read(keys.connections, defaultConnections),
  setConnections: (value: Connection[]) => write(keys.connections, value),
  getSources: readSources,
  setSources: (value: CatalogSource[]) => write(keys.sources, value),
  getRuns: () => read<EvaluationRun[]>(keys.runs, []),
  setRuns: (value: EvaluationRun[]) => write(keys.runs, value.slice(0, 100)),
  getLocalSuites: () => read<LocalSuite[]>(keys.localSuites, []),
  setLocalSuites: (value: LocalSuite[]) => write(keys.localSuites, value),
  getInterfaceScale: (): InterfaceScale => {
    const value = read<InterfaceScale>(keys.interfaceScale, "default");
    return interfaceScales.includes(value) ? value : "default";
  },
  setInterfaceScale: (value: InterfaceScale) => write(keys.interfaceScale, value)
};

const sessionSecrets = new Map<string, string>();

export async function setSecret(connectionId: string, secret: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("store_secret", { connectionId, secret });
    return;
  }
  sessionSecrets.set(connectionId, secret);
}

export async function getSecret(connectionId: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("get_secret", { connectionId })) ?? "";
  }
  return sessionSecrets.get(connectionId) ?? "";
}

export async function deleteSecret(connectionId: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_secret", { connectionId });
    return;
  }
  sessionSecrets.delete(connectionId);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
