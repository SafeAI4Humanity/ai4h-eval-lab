import type { ProviderProxySettings } from "./providerProxy";
import type { CatalogSource, Connection, EvaluationRun, LocalSuite } from "../types";

export type InterfaceScale = "default" | "comfortable" | "large" | "extra-large";

const keys = {
  connections: "ai4h.connections.v1",
  sources: "ai4h.sources.v1",
  runs: "ai4h.runs.v1",
  localSuites: "ai4h.local-suites.v1",
  providerProxy: "ai4h.provider-proxy.v1",
  interfaceScale: "ai4h.interface-scale.v1"
};

const interfaceScales: InterfaceScale[] = ["default", "comfortable", "large", "extra-large"];

const PROXY_SECRET_ID = "provider-proxy";

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
    const saved = read<Partial<ProviderProxySettings>>(keys.providerProxy, {});
    const config = { enabled: Boolean(saved.enabled), url: saved.url ?? "" };
    if (saved.key) {
      // Migrate entries persisted before the key lived in the secret storage boundary.
      await setSecret(PROXY_SECRET_ID, saved.key);
      write(keys.providerProxy, config);
    }
    return { ...config, key: await getSecret(PROXY_SECRET_ID) };
  },
  setProviderProxy: async (value: ProviderProxySettings): Promise<void> => {
    const key = value.key ?? "";
    const previousKey = await getSecret(PROXY_SECRET_ID);
    const config = { enabled: value.enabled, url: value.url };
    // Commit the credential first, then persist the matching configuration in the
    // same synchronous continuation, so a concurrent request can never observe a
    // URL paired with a credential that does not belong to it. Nothing is
    // persisted before the credential is ready, so a rejected vault write leaves
    // the stored pair coherent instead of a half-committed state.
    try {
      if (key) await setSecret(PROXY_SECRET_ID, key);
      else await deleteSecret(PROXY_SECRET_ID);
    } catch (error) {
      try {
        if (previousKey) await setSecret(PROXY_SECRET_ID, previousKey);
        else await deleteSecret(PROXY_SECRET_ID);
      } catch {
        // Rollback failed; surface the original error.
      }
      throw error;
    }
    write(keys.providerProxy, config);
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
