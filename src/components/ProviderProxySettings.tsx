import { useEffect, useState } from "react";
import { isTauri, storage } from "../services/storage";
import { ProviderProxySettings as ProxySettings, normalizeProxyUrl, saveProviderProxy } from "../services/providerProxy";

export function ProviderProxySettings() {
  const [settings, setSettings] = useState<ProxySettings>({ enabled: false, url: "", key: "" });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    // The vault lookup is async on desktop: hold the form closed until the stored
    // settings resolve, so a save cannot overwrite an existing configuration with
    // the empty defaults or delete its credential, and a late resolution cannot
    // discard edits.
    storage.getProviderProxy().then((resolved) => {
      setSettings(resolved);
      setLoading(false);
    });
  }, []);
  let validationError = "";
  if (settings.enabled) {
    try { normalizeProxyUrl(settings.url); }
    catch (error) { validationError = (error as Error).message; }
  }
  const save = async () => {
    try {
      await saveProviderProxy(settings);
      setSettings(await storage.getProviderProxy());
      setSaved(true);
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the provider proxy.");
    }
  };
  return (
    <section className="panel settings-section" id="provider-proxy-settings">
      <div className="panel-heading"><div><h3>Model provider proxy</h3><p>One proxy for every model provider, including local providers, connection checks, evaluations, and model-assisted reviews.</p></div></div>
      <div className="provider-proxy-body">
        <label className="toggle-row"><input type="checkbox" disabled={loading} checked={settings.enabled} onChange={(event) => { setSettings({ ...settings, enabled: event.target.checked }); setSaved(false); setSaveError(""); }} /><span>Use a proxy for all model providers</span></label>
        <label className="field"><span>Proxy URL</span><input type="url" value={settings.url} disabled={loading || !settings.enabled} placeholder="http://localhost:8080 or https://proxy.example.com:8443" autoComplete="off" spellCheck={false} onChange={(event) => { setSettings({ ...settings, url: event.target.value }); setSaved(false); setSaveError(""); }} aria-describedby="provider-proxy-help" /></label>
        <label className="field"><span>Proxy API key</span><input type="password" value={settings.key ?? ""} disabled={loading || !settings.enabled} placeholder="Optional gateway key or Basic auth password" autoComplete="off" spellCheck={false} onChange={(event) => { setSettings({ ...settings, key: event.target.value }); setSaved(false); setSaveError(""); }} aria-describedby="provider-proxy-help" /></label>
        <p id="provider-proxy-help" className="form-note">Accepts HTTP or HTTPS proxy addresses without embedded credentials. An optional proxy API key is sent as `Proxy-Authorization: Basic` for proxies that require proxy authentication. Changes apply to new requests after saving. When enabled, requests never fall back to a direct connection. Catalogs and app updates use their usual connection.</p>
        {!isTauri() && <p className="form-note">Proxy routing requires the desktop app. Browser preview blocks provider requests while this setting is enabled.</p>}
        {loading && <p className="form-note">Loading the stored proxy settings…</p>}
        {(validationError || saveError) && <p className="provider-proxy-error" role="alert">{validationError || saveError}</p>}
      </div>
      <div className="provider-proxy-actions"><button className="button button-primary button-small" disabled={loading || Boolean(validationError)} onClick={save}>Save proxy settings</button>{saved && <span role="status">Proxy settings saved.</span>}</div>
    </section>
  );
}
