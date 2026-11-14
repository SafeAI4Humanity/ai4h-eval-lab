// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderProxySettings } from "./ProviderProxySettings";
import { storage } from "../services/storage";

vi.mock("../services/storage", () => ({ storage: { getProviderProxy: vi.fn() }, isTauri: vi.fn(() => true) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("keeps the form closed until the stored proxy settings resolve", async () => {
  let resolveLoad: (settings: { enabled: boolean; url: string; key: string }) => void = () => {};
  vi.mocked(storage.getProviderProxy).mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));

  render(<ProviderProxySettings />);
  const save = screen.getByRole("button", { name: "Save proxy settings" }) as HTMLButtonElement;
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  const url = screen.getByLabelText("Proxy URL") as HTMLInputElement;
  const key = screen.getByLabelText("Proxy API key") as HTMLInputElement;

  // Nothing can be edited or saved while the vault lookup is still in flight, so a
  // save cannot overwrite the stored configuration with the empty defaults.
  await waitFor(() => expect(screen.getByText(/Loading the stored proxy settings/)).toBeTruthy());
  expect(save.disabled).toBe(true);
  expect(checkbox.disabled).toBe(true);
  expect(url.disabled).toBe(true);
  expect(key.disabled).toBe(true);

  resolveLoad({ enabled: true, url: "https://proxy.example:8443", key: "gateway key" });
  await waitFor(() => {
    expect(save.disabled).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect((screen.getByLabelText("Proxy URL") as HTMLInputElement).value).toBe("https://proxy.example:8443");
    expect((screen.getByLabelText("Proxy API key") as HTMLInputElement).value).toBe("gateway key");
  });
});

it("surfaces a failed vault lookup and keeps a recovery path open", async () => {
  vi.mocked(storage.getProviderProxy).mockRejectedValue(new Error("keychain unavailable"));

  render(<ProviderProxySettings />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("keychain unavailable"));

  // The form is not left frozen forever without an error: the controls reopen so
  // the user can disable the persisted configuration (or retry once the vault is
  // available).
  const save = screen.getByRole("button", { name: "Save proxy settings" }) as HTMLButtonElement;
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  expect(save.disabled).toBe(false);
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
});
