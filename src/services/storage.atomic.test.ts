// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { storage } from "./storage";
import { saveProviderProxy } from "./providerProxy";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PERSISTED = "ai4h.provider-proxy.v1";
const vault = new Map<string, string>();
// Persisted config snapshot taken at the moment each vault write lands.
const configAtCommit: (string | null)[] = [];

function fakeVault(failWrites = false) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: Record<string, string>) => {
    const id = args?.connectionId ?? "";
    if (command === "get_secret") return vault.get(id) ?? "";
    if (failWrites) throw new Error("vault unavailable");
    if (command === "store_secret") {
      configAtCommit.push(localStorage.getItem(PERSISTED));
      vault.set(id, args?.secret ?? "");
      return null;
    }
    configAtCommit.push(localStorage.getItem(PERSISTED));
    vault.delete(id);
    return null;
  });
}

beforeEach(() => {
  localStorage.clear();
  vault.clear();
  configAtCommit.length = 0;
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  fakeVault();
});

it("commits the credential before the new URL becomes visible to requests", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  configAtCommit.length = 0;

  await saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "new key" });

  // At the vault write, the persisted config still paired the old URL with the
  // old credential; the new URL was published only after its key was committed.
  expect(configAtCommit).toEqual([JSON.stringify({ enabled: true, url: "http://proxy:8080" })]);
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://newproxy:9090" });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://newproxy:9090", key: "new key" });
});

it("persists nothing and keeps the stored pair coherent when the vault write fails", async () => {
  await saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "old key" });
  fakeVault(true);

  await expect(saveProviderProxy({ enabled: true, url: "http://newproxy:9090", key: "broken key" })).rejects.toThrow("vault unavailable");

  // The UI reports the save failed; nothing half-committed remains: the config
  // still shows the URL that matches the credential in the vault.
  expect(JSON.parse(localStorage.getItem(PERSISTED)!)).toEqual({ enabled: true, url: "http://proxy:8080" });
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "http://proxy:8080", key: "old key" });
});
