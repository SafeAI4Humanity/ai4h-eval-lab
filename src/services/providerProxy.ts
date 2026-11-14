import { storage } from "./storage";

export type ProxyOption =
  | string
  | {
      url: string;
      basicAuth?: { username: string; password: string };
    };

export type ProviderProxySettings = {
  enabled: boolean;
  url: string;
  key?: string;
};

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

export function normalizeProxyKey(value: string | undefined): string {
  // Proxy credentials are opaque: Tauri sends basicAuth.password verbatim to the
  // proxy server, so trimming or stripping a "Bearer " prefix can break
  // authentication for values the user entered correctly. Only an absent value
  // counts as "no key".
  return value ?? "";
}

export function normalizeProviderProxySettings(settings: ProviderProxySettings): ProviderProxySettings {
  return {
    enabled: settings.enabled,
    url: settings.url,
    key: normalizeProxyKey(settings.key)
  };
}

export function providerProxyOption(settings: ProviderProxySettings): ProxyOption | undefined {
  if (!settings.enabled) return undefined;

  const url = normalizeProxyUrl(settings.url);
  const key = normalizeProxyKey(settings.key);

  if (!key) return url;

  return {
    url,
    basicAuth: { username: "", password: key }
  };
}

export async function saveProviderProxy(settings: ProviderProxySettings): Promise<void> {
  let url = "";
  try { url = normalizeProxyUrl(settings.url); }
  catch (error) { if (settings.enabled) throw error; }

  await storage.setProviderProxy({
    enabled: settings.enabled,
    url,
    key: normalizeProxyKey(settings.key)
  });
}
