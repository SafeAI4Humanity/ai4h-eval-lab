// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { storage } from "./storage";
import { saveProviderProxy } from "./providerProxy";

const PERSISTED = "ai4h.provider-proxy.v1";
const vault = new Map<string, string>();
// Persisted config snapshot taken at the moment each vault write lands.
const configAtCommit: (string | null)[] = [];

// Fake vault behind the Tauri IPC seam: storage's real code path resolves the
// command handler, which is exactly this function, so the suite is deterministic
// without module-mocking identity issues.
let gate: Promise<string> | null = null;
let failWrites = false;

const handler = vi.fn(async (command: string, args?: Record<string, unknown>) => {
  const payload = (args ?? {}) as Record<string, unknown>;
  const id = String(payload.connectionId ?? "");
  if (command === "get_secret") {
    if (gate) {
      const pending = gate;
      gate = null;
      return pending.then(() => vault.get(id) ?? "");
    }
    return vault.get(id) ?? "";
  }
  if (failWrites) throw new Error("vault unavailable");
  if (command === "store_secret") {
    configAtCommit.push(localStorage.getItem(PERSISTED));
    vault.set(id, String(payload.secret ?? ""));
    return null;
  }
  if (command === "delete_secret") {
    configAtCommit.push(localStorage.getItem(PERSISTED));
    vault.delete(id);
    return null;
  }
  return null;
});

beforeEach(() => {
  localStorage.clear();
  vault.clear();
  configAtCommit.length = 0;
  gate = null;
  failWrites = false;
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: handler };
});

it("commits the credential before the new URL becomes visible to requests", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  configAtCommit.length = 0;

  await saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "new key" });

  // At the vault write, the persisted config still paired the old URL with the
  // old credential; the new URL was published only after its key was committed
  // (the second recorded snapshot is the post-publish cleanup of the old version).
  expect(configAtCommit).toEqual([
    JSON.stringify({ enabled: true, url: "http://proxy:8080", secretVersion: 1 }),
    JSON.stringify({ enabled: true, url: "http://newproxy:9090", secretVersion: 2 })
  ]);
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://newproxy:9090", secretVersion: 2 });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://newproxy:9090", key: "new key" });
});

it("persists nothing and keeps the stored pair coherent when the vault write fails", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  failWrites = true;

  await expect(saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "broken key" })).rejects.toThrow("vault unavailable");

  // The UI reports the save failed; nothing half-committed remains: the config
  // still shows the URL that matches the credential in the vault.
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://proxy:8080", secretVersion: 1 });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://proxy:8080", key: "old key" });
});

it("never returns a stale config snapshot paired with a credential from a newer version", async () => {
  await saveProviderProxy({ enabled: true, url: "http://oldproxy:1111", key: "old key" });

  // The reader snapshots version 1 and stalls mid-lookup; a full save (new URL +
  // new credential committed as one version) lands while the lookup is in flight.
  let release: (value: string) => void = () => {};
  gate = new Promise<string>((resolve) => { release = resolve; });
  const pending = storage.getProviderProxy();
  await saveProviderProxy({ enabled: true, url: "http://newproxy:2222", key: "new key" });
  release("");

  // The stale snapshot is detected and re-resolved as a coherent pair — never the
  // old URL paired with the new credential.
  const result = await pending;
  expect(result).not.toEqual({ enabled: true, url: "http://oldproxy:1111", key: "new key" });
  expect(result).toEqual({ enabled: true, url: "http://newproxy:2222", key: "new key" });
});
