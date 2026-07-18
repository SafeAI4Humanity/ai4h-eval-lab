import { isTauri } from "./storage";
import { diagnosticLog, redactDiagnosticUrl } from "./diagnostics";

export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  const desktop = isTauri();
  const method = init?.method ?? "GET";
  const url = redactDiagnosticUrl(input);
  diagnosticLog("debug", "network.request", { method, url, transport: desktop ? "tauri-http" : "browser-fetch" });
  try {
    let response: Response;
    if (desktop) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      response = await fetch(input, init);
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
    diagnosticLog("error", "network.failure", {
      method,
      url,
      durationMs: Date.now() - startedAt,
      transport: desktop ? "tauri-http" : "browser-fetch",
      error: error instanceof Error ? error.message : String(error)
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
