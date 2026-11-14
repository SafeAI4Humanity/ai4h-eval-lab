// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderProxySettings } from "./ProviderProxySettings";
import { saveProviderProxy } from "../services/providerProxy";
import { storage } from "../services/storage";

vi.mock("../services/storage", () => ({ storage: { getProviderProxy: vi.fn() }, isTauri: vi.fn(() => true) }));
vi.mock("../services/providerProxy", () => ({ saveProviderProxy: vi.fn(), normalizeProxyUrl: (value: string) => value }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("locks the form while a save is pending", async () => {
  let resolveSave: () => void = () => {};
  vi.mocked(storage.getProviderProxy).mockResolvedValue({ enabled: true, url: "http://proxy:8080", key: "gateway key" });
  vi.mocked(saveProviderProxy).mockReturnValue(new Promise<void>((resolve) => { resolveSave = resolve; }));

  render(<ProviderProxySettings />);
  await waitFor(() => expect((screen.getByLabelText("Proxy URL") as HTMLInputElement).value).toBe("http://proxy:8080"));

  const save = screen.getByRole("button", { name: "Save proxy settings" }) as HTMLButtonElement;
  fireEvent.click(save);

  // With slow vault IPC the save is in flight for a while. The form must stay
  // locked: an edit made now would be discarded by the post-save refetch, and a
  // second click would start another write allocating the same secretVersion.
  await waitFor(() => expect(save.disabled).toBe(true));
  expect((screen.getByLabelText("Proxy URL") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Proxy API key") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);

  // A second click during the pending save must not start a second write.
  fireEvent.click(save);
  expect(saveProviderProxy).toHaveBeenCalledTimes(1);

  resolveSave();
  await waitFor(() => expect(save.disabled).toBe(false));
  expect((screen.getByLabelText("Proxy URL") as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByText("Proxy settings saved.")).toBeTruthy();
});

it("clears the stale load error once a save recovers the configuration", async () => {
  const getProxy = vi.mocked(storage.getProviderProxy);
  getProxy.mockRejectedValueOnce(new Error("keychain unavailable"));
  getProxy.mockResolvedValue({ enabled: false, url: "", key: "" });
  vi.mocked(saveProviderProxy).mockResolvedValue(undefined);

  render(<ProviderProxySettings />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("keychain unavailable"));

  // The advertised recovery path: disable the persisted configuration and save.
  // Once the save and reload succeed, the stale keychain failure must not keep
  // rendering as an alert next to the confirmation.
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  fireEvent.click(checkbox);
  const save = screen.getByRole("button", { name: "Save proxy settings" }) as HTMLButtonElement;
  fireEvent.click(save);

  await waitFor(() => expect(screen.getByText("Proxy settings saved.")).toBeTruthy());
  expect(screen.queryByRole("alert")).toBeNull();
});
