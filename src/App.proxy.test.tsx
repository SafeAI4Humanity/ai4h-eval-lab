// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App, { Connections } from "./App";
import { ProviderProxySettings } from "./components/ProviderProxySettings";
import { storage } from "./services/storage";
import { testConnection } from "./services/providers";

vi.mock("./services/providers", async (original) => ({ ...await original<typeof import("./services/providers")>(), testConnection: vi.fn() }));
vi.mock("./services/catalog", async (original) => {
  const actual = await original<typeof import("./services/catalog")>();
  return { ...actual, refreshCatalogs: vi.fn(async (sources) => ({ sources, suites: actual.bundledSuites() })) };
});
vi.mock("./services/updates", async (original) => ({ ...await original<typeof import("./services/updates")>(), checkForAppUpdate: vi.fn(async () => ({ updateAvailable: false, release: { tagName: "v0.15.1", version: "0.15.1", name: "release", url: "https://github.com/SafeAI4Humanity/ai4h-eval-lab/releases/tag/v0.15.1", publishedAt: "2026-11-12T00:00:00Z" } })) }));
vi.mock("./services/updater", async (original) => ({ ...await original<typeof import("./services/updater")>(), checkInAppUpdate: vi.fn(async () => null) }));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

it("validates the proxy URL and saves one setting that persists after reopening", async () => {
  const view = render(<ProviderProxySettings />);
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Proxy URL"), { target: { value: "socks5://proxy:1080" } });
  expect(screen.getByRole("alert").textContent).toContain("HTTP or HTTPS");
  expect((screen.getByRole("button", { name: "Save proxy settings" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Proxy URL"), { target: { value: "https://proxy.example:8443/" } });
  fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
  await expect(storage.getProviderProxy()).resolves.toEqual({ enabled: true, url: "https://proxy.example:8443", key: "" });
  expect(JSON.parse(localStorage.getItem("ai4h.provider-proxy.v1")!)).toEqual({ enabled: true, url: "https://proxy.example:8443", secretVersion: 1, hasSecret: false });
  view.unmount();
  render(<ProviderProxySettings />);
  await waitFor(() => {
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Proxy URL") as HTMLInputElement).value).toBe("https://proxy.example:8443");
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
  expect((await storage.getProviderProxy()).enabled).toBe(false);
});

it("saves an optional proxy key through the secret storage boundary, not localStorage", async () => {
  render(<ProviderProxySettings />);
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Proxy URL"), { target: { value: "http://proxy.example:3128" } });
  fireEvent.change(screen.getByLabelText("Proxy API key"), { target: { value: "Bearer gateway key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
  expect(JSON.parse(localStorage.getItem("ai4h.provider-proxy.v1")!)).toEqual({ enabled: true, url: "http://proxy.example:3128", secretVersion: 1, hasSecret: true });
  await expect(storage.getProviderProxy()).resolves.toEqual({
    enabled: true,
    url: "http://proxy.example:3128",
    key: "Bearer gateway key"
  });
});

it("opens Settings at the proxy section from the Connections link", async () => {
  const scroll = vi.fn();
  const previous = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Connections" }));
    fireEvent.click(screen.getByRole("link", { name: "Configure the proxy for all model providers" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Model provider proxy" })).toBeTruthy());
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("provider-proxy-settings"));
  } finally {
    Element.prototype.scrollIntoView = previous;
  }
});

it("shows failed connection checks as an actionable error", async () => {
  vi.mocked(testConnection).mockRejectedValueOnce(new Error("Provider request through the proxy failed. Check the proxy server. No direct connection was attempted."));
  const onChange = vi.fn();
  render(<Connections connections={storage.getConnections()} onChange={onChange} onProxySettings={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Scan models" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("through the proxy failed"));
  expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ status: "unavailable" })]);
});
