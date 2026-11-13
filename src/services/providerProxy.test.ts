// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { fetch as desktopFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { appFetch, providerFetch } from "./http";
import { normalizeProxyKey, normalizeProxyUrl, providerProxyOption, saveProviderProxy } from "./providerProxy";
import { isTauri, storage } from "./storage";
import { discoverModels, generateResponse, generateAgentTurn } from "./providers";
import type { Connection, ProviderKind } from "../types";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./storage", async (original) => ({ ...await original<typeof import("./storage")>(), isTauri: vi.fn(), getSecret: vi.fn().mockResolvedValue("") }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(desktopFetch).mockImplementation(async () => new Response(JSON.stringify({
    data: [{ id: "test-model" }], models: [], message: { content: "Answer" },
    choices: [{ message: { content: "Answer" } }], content: [{ type: "text", text: "Answer" }],
    candidates: [{ content: { parts: [{ text: "Answer" }] } }]
  })));
});

it.each(["http://localhost:8080", "https://proxy.example:8443"])("persists and routes HTTP and HTTPS targets through %s", async (url) => {
  saveProviderProxy({ enabled: true, url });
  expect(storage.getProviderProxy()).toEqual({ enabled: true, url, key: "" });
  const controller = new AbortController();
  for (const destination of ["http://localhost:11434/api/chat", "https://model.example/v1/chat"]) {
    await providerFetch(destination, { method: "POST", headers: { Authorization: "Bearer test" }, body: "{}", signal: controller.signal });
    expect(desktopFetch).toHaveBeenLastCalledWith(destination, expect.objectContaining({ proxy: { all: url }, method: "POST", body: "{}", signal: controller.signal, headers: { Authorization: "Bearer test" } }));
  }
});

it("normalizes a saved proxy key and sends Basic proxy auth when present", async () => {
  expect(normalizeProxyKey("Bearer gateway key")).toBe("gateway key");
  expect(providerProxyOption({ enabled: true, url: "http://proxy:8080", key: "gateway key" })).toEqual({
    url: "http://proxy:8080",
    basicAuth: { username: "", password: "gateway key" }
  });

  saveProviderProxy({ enabled: true, url: "http://proxy:8080", key: "Bearer gateway key" });
  expect(storage.getProviderProxy()).toEqual({
    enabled: true,
    url: "http://proxy:8080",
    key: "gateway key"
  });

  await providerFetch("https://model.example");
  expect(desktopFetch).toHaveBeenCalledWith(
    "https://model.example",
    expect.objectContaining({
      proxy: {
        all: {
          url: "http://proxy:8080",
          basicAuth: { username: "", password: "gateway key" }
        }
      }
    })
  );
});

it.each(["", "socks5://localhost:1080", "ftp://proxy", "proxy:8080", "http://user:pass@proxy", "https://proxy/path", "https://proxy?token=secret", "http://proxy#fragment"])("rejects invalid/unsupported proxy configuration %s", (url) => {
  expect(() => normalizeProxyUrl(url)).toThrow();
  expect(() => saveProviderProxy({ enabled: true, url })).toThrow();
  expect(storage.getProviderProxy().enabled).toBe(false);
});

it("fails closed with a useful proxy error and never performs a direct diagnostic probe", async () => {
  saveProviderProxy({ enabled: true, url: "https://proxy.example:8443" });
  vi.mocked(desktopFetch).mockRejectedValueOnce(new Error("Connection refused"));
  await expect(providerFetch("https://model.example")).rejects.toThrow(/through the proxy failed.*No direct connection was attempted.*Connection refused/);
  expect(desktopFetch).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

it("reports proxy authentication errors", async () => {
  saveProviderProxy({ enabled: true, url: "http://proxy:8080" });
  vi.mocked(desktopFetch).mockResolvedValueOnce(new Response("", { status: 407 }));
  await expect(providerFetch("https://model.example")).rejects.toThrow(/proxy requires authentication/);
  expect(desktopFetch).toHaveBeenCalledTimes(1);
});

it("does not mislabel cancellation as a proxy failure", async () => {
  saveProviderProxy({ enabled: true, url: "http://proxy:8080" });
  const error = new DOMException("Cancelled", "AbortError");
  vi.mocked(desktopFetch).mockRejectedValueOnce(error);
  await expect(providerFetch("https://model.example")).rejects.toBe(error);
});

it("blocks proxy-enabled browser requests instead of silently sending them directly", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const browser = vi.spyOn(window, "fetch");
  saveProviderProxy({ enabled: true, url: "http://proxy:8080" });
  await expect(providerFetch("https://model.example")).rejects.toThrow(/requires the desktop app/);
  expect(browser).not.toHaveBeenCalled();
  browser.mockRestore();
});

it("leaves catalog/update transport unchanged and disables provider proxy routing when switched off", async () => {
  saveProviderProxy({ enabled: true, url: "http://proxy:8080" });
  await appFetch("https://github.com/catalog.json");
  expect(desktopFetch).toHaveBeenLastCalledWith("https://github.com/catalog.json", {});
  saveProviderProxy({ enabled: false, url: "http://proxy:8080" });
  await providerFetch("https://model.example");
  expect(desktopFetch).toHaveBeenLastCalledWith("https://model.example", {});
});

it.each<ProviderKind>(["ollama", "openai", "openai-compatible", "openrouter", "anthropic", "gemini", "kie"])("routes discovery, text evaluation and agent turns for %s through the global proxy", async (provider) => {
  saveProviderProxy({ enabled: true, url: "https://proxy.example:8443" });
  const connection: Connection = { id: provider, name: provider, provider, baseUrl: "https://model.example", enabled: true };
  const options = { model: provider === "kie" ? "gpt-5-2" : "test-model", messages: [{ role: "user" as const, content: "Hi" }] };
  await discoverModels(connection);
  await generateResponse(connection, options);
  await generateAgentTurn(connection, { ...options, tools: [] });
  expect(vi.mocked(desktopFetch).mock.calls.length).toBeGreaterThanOrEqual(3);
  for (const [, options] of vi.mocked(desktopFetch).mock.calls) expect(options?.proxy).toEqual({ all: "https://proxy.example:8443" });
});

it("rejects invalid persisted enabled settings without sending a request", async () => {
  storage.setProviderProxy({ enabled: true, url: "socks5://proxy:1080" });
  await expect(providerFetch("https://model.example")).rejects.toThrow(/valid HTTP or HTTPS/);
  expect(desktopFetch).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("can disable an invalid setting without persisting embedded credentials", () => {
  saveProviderProxy({ enabled: false, url: "http://user:secret@proxy:8080", key: "Bearer gateway key" });
  expect(storage.getProviderProxy()).toEqual({ enabled: false, url: "", key: "gateway key" });
});
