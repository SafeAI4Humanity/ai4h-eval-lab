// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { executeRun } from "./services/runner";
import type { EvaluationRun } from "./types";

vi.mock("./services/runner", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/runner")>(),
  executeRun: vi.fn()
}));
vi.mock("./services/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("./services/catalog")>();
  return { ...original, refreshCatalogs: vi.fn(async (sources) => ({ sources, suites: original.bundledSuites })) };
});
vi.mock("./services/updates", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/updates")>(),
  checkForAppUpdate: vi.fn(async () => ({ release: undefined as never, updateAvailable: false }))
}));
vi.mock("./services/updater", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/updater")>(),
  checkInAppUpdate: vi.fn(async () => null)
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const openBuilderAndStart = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "New evaluation" })[0]);
  fireEvent.click(screen.getByRole("button", { name: /Select all tests/ }));
  fireEvent.click(screen.getByRole("button", { name: /Local Ollama/ }));
  fireEvent.change(screen.getByPlaceholderText("Exact model ID"), { target: { value: "test-model" } });
  fireEvent.click(screen.getByRole("button", { name: "Start evaluation" }));
};

it("bounces a second start attempt back to the live run with an explanation", async () => {
  vi.mocked(executeRun).mockReturnValue(new Promise<EvaluationRun>(() => {})); // stays active forever
  render(<App />);
  openBuilderAndStart();
  await waitFor(() => expect(executeRun).toHaveBeenCalledTimes(1));
  openBuilderAndStart(); // the earlier navigation dropped the form's selections
  await waitFor(() => expect(screen.getByText("Evaluation in progress — returned to the live run.")).toBeTruthy());
  expect(executeRun).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain("returned to the live run");
});
