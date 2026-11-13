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
let failReads = false;
let failDeletes = false;

const handler = vi.fn(async (command: string, args?: Record<string, unknown>) => {
  const payload = (args ?? {}) as Record<string, unknown>;
  const id = String(payload.connectionId ?? "");
  if (command === "get_secret") {
    if (failReads) throw new Error("keychain unavailable");
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
    if (failDeletes) throw new Error("keychain unavailable");
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
  failReads = false;
  failDeletes = false;
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
    JSON.stringify({ enabled: true, url: "http://proxy:8080", secretVersion: 1, hasSecret: true }),
    JSON.stringify({ enabled: true, url: "http://newproxy:9090", secretVersion: 2, hasSecret: true })
  ]);
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://newproxy:9090", secretVersion: 2, hasSecret: true });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://newproxy:9090", key: "new key" });
});

it("persists nothing and keeps the stored pair coherent when the vault write fails", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  failWrites = true;

  await expect(saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "broken key" })).rejects.toThrow("vault unavailable");

  // The UI reports the save failed; nothing half-committed remains: the config
  // still shows the URL that matches the credential in the vault.
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://proxy:8080", secretVersion: 1, hasSecret: true });
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

it("skips the vault lookup when the persisted version has no credential", async () => {
  // Fresh install: nothing persisted, so version 0 has never had a credential.
  // A locked keychain must not prevent requests from observing the config.
  failReads = true;
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: false, url: "", key: "" });

  // A keyless save records that its version has no credential, so reads never
  // query the keychain and local providers stay usable.
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "" });
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://proxy:8080", secretVersion: 1, hasSecret: false });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://proxy:8080", key: "" });
});

it("reports the save as committed when post-commit cleanup of the superseded entry fails", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  failDeletes = true;

  // Cleanup failure must not flip the already-committed save into a reported failure.
  await expect(saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "new key" })).resolves.toBeUndefined();

  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://newproxy:9090", secretVersion: 2, hasSecret: true });
  expect(vault.get("provider-proxy:2")).toBe("new key");
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://newproxy:9090", key: "new key" });
});
