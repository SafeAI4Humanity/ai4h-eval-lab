import { storage } from "./storage";

export type ProviderProxySettings = { enabled: boolean; url: string };

export function normalizeProxyUrl(value: string): string {
  let url: URL;
  try {
    if (!/^https?:\/\//i.test(value.trim())) throw new Error();
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS proxy URL, such as http://localhost:8080.");
  }
  if (url.username || url.password) throw new Error("Proxy URLs with embedded credentials are not supported.");
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Use the proxy server address and port, without a path, query, or fragment.");
  }
  return url.origin;
}

export function saveProviderProxy(settings: ProviderProxySettings): void {
  let url = "";
  try { url = normalizeProxyUrl(settings.url); }
  catch (error) { if (settings.enabled) throw error; }
  storage.setProviderProxy({ enabled: settings.enabled, url });
}
