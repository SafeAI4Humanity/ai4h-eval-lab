import type { CatalogSource, Connection, EvaluationRun } from "../types";

export type InterfaceScale = "default" | "comfortable" | "large" | "extra-large";

const keys = {
  connections: "ai4h.connections.v1",
  sources: "ai4h.sources.v1",
  runs: "ai4h.runs.v1",
  interfaceScale: "ai4h.interface-scale.v1"
};

const interfaceScales: InterfaceScale[] = ["default", "comfortable", "large", "extra-large"];

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
  }
];

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
  getConnections: () => read(keys.connections, defaultConnections),
  setConnections: (value: Connection[]) => write(keys.connections, value),
  getSources: () => read(keys.sources, defaultSources),
  setSources: (value: CatalogSource[]) => write(keys.sources, value),
  getRuns: () => read<EvaluationRun[]>(keys.runs, []),
  setRuns: (value: EvaluationRun[]) => write(keys.runs, value.slice(0, 100)),
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
  return "__TAURI_INTERNALS__" in window;
}
