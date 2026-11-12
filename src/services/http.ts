import { normalizeProxyUrl } from "./providerProxy";
import { storage, isTauri } from "./storage";
import { diagnosticLog, redactDiagnosticUrl } from "./diagnostics";

export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  return transportFetch(input, init);
}

/** A single setting covers discovery, evaluation, agent turns, and reviews. */
export async function providerFetch(input: string, init?: RequestInit): Promise<Response> {
  const settings = storage.getProviderProxy();
  const proxyUrl = settings.enabled ? normalizeProxyUrl(settings.url) : undefined;
  if (proxyUrl && !isTauri()) {
    throw new Error("Provider proxy routing requires the desktop app. Disable the proxy to use browser preview.");
  }
  try {
    const response = await transportFetch(input, init, proxyUrl);
    if (proxyUrl && response.status === 407) {
      throw new Error("The proxy requires authentication (HTTP 407).");
    }
    return response;
  } catch (error) {
    if (!proxyUrl || init?.signal?.aborted || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Provider request through the proxy failed. Check the proxy server and Settings & sources → Model provider proxy. No direct connection was attempted. Details: ${detail}`, { cause: error });
  }
}

async function transportFetch(input: string, init?: RequestInit, proxyUrl?: string): Promise<Response> {
  const startedAt = Date.now();
  const desktop = isTauri();
  const method = init?.method ?? "GET";
  const url = redactDiagnosticUrl(input);
  diagnosticLog("debug", "network.request", { method, url, transport: desktop ? "tauri-http" : "browser-fetch" });
  try {
    let response: Response;
    if (desktop) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      response = await fetch(input, { ...init, ...(proxyUrl ? { proxy: { all: proxyUrl } } : {}) });
    } else {
      response = await window.fetch(input, init);
    }
    diagnosticLog(response.ok ? "info" : "error", "network.response", {
      method,
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      transport: desktop ? "tauri-http" : "browser-fetch"
    });
    return response;
  } catch (error) {
    let causeChain: string | undefined = undefined;
    // A direct diagnostic probe would bypass an enabled provider proxy.
    if (desktop && !proxyUrl) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        causeChain = await invoke("probe_url", { url: input });
      } catch {
        // The probe is best-effort diagnostics; never mask the original failure.
      }
    }
    diagnosticLog("error", "network.failure", {
      method,
      url,
      durationMs: Date.now() - startedAt,
      transport: desktop ? "tauri-http" : "browser-fetch",
      error: error instanceof Error ? error.message : String(error),
      causeChain,
      providerProxy: Boolean(proxyUrl)
    });
    throw error;
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      detail =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message ?? parsed.message ?? body;
    } catch {
      // Keep the response body as the error detail.
    }
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  return body ? JSON.parse(body) : {};
}
