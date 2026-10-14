// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Authoring, NewEvaluation } from "./App";
import { goldenSuite } from "./services/canonical.golden";
import { newLocalSuite, withSuite } from "./services/localSuites";
import type { LocalSuite } from "./types";

afterEach(cleanup);
function Editor({ initial, onRun = vi.fn() }: { initial: LocalSuite[]; onRun?: (suite: LocalSuite["suite"]) => void }) {
  const [locals, setLocals] = useState(initial);
  return <Authoring localSuites={locals} onChange={setLocals} onRunSuite={onRun} />;
}
const filled = () => withSuite(newLocalSuite(), { ...goldenSuite, cases: [structuredClone(goldenSuite.cases[0])] });

it("preserves a suite rename and allows creating and selecting another draft", () => {
  render(<Editor initial={[newLocalSuite()]} />);
  fireEvent.change(screen.getByLabelText("Suite id"), { target: { value: "renamed-suite" } });
  expect((screen.getByLabelText("Suite id") as HTMLInputElement).value).toBe("renamed-suite");
  const firstLocalId = (screen.getByLabelText("Local suite") as HTMLSelectElement).value;
  fireEvent.click(screen.getByText("New suite"));
  expect((screen.getByLabelText("Suite id") as HTMLInputElement).value).toBe("my-suite");
  fireEvent.change(screen.getByLabelText("Local suite"), { target: { value: firstLocalId } });
  expect((screen.getByLabelText("Suite id") as HTMLInputElement).value).toBe("renamed-suite");
});

it("initializes a phrase evaluator and accepts its first value", () => {
  const local = newLocalSuite();
  render(<Editor initial={[local]} />);
  fireEvent.change(screen.getByLabelText("Evaluator type"), { target: { value: "contains_any" } });
  fireEvent.change(screen.getByLabelText("Expected phrases (any match passes) item"), { target: { value: "test" } });
  fireEvent.keyDown(screen.getByLabelText("Expected phrases (any match passes) item"), { key: "Enter" });
  expect(document.querySelector(".yaml-view")!.textContent).toContain("- test");
});

it("switches evaluator types without crashing and discards old fields", () => {
  render(<Editor initial={[filled()]} />);
  const types = screen.getAllByLabelText("Evaluator type");
  fireEvent.change(types[0], { target: { value: "contains_none" } });
  expect(screen.getByText("Excluded phrases (any match fails)")).toBeTruthy();
  fireEvent.change(types[0], { target: { value: "valid_json" } });
  const yaml = document.querySelector(".yaml-view")!.textContent!;
  expect(yaml).toContain("type: valid_json");
  expect(yaml).not.toContain("values:");
});

it("actually removes an evaluator", () => {
  render(<Editor initial={[filled()]} />);
  expect(screen.getAllByLabelText("Evaluator type")).toHaveLength(2);
  fireEvent.click(screen.getAllByLabelText("Remove evaluator")[0]);
  expect(screen.getAllByLabelText("Evaluator type")).toHaveLength(1);
});

it("requires canonicalization before running and exporting, and disables export for invalid metadata", async () => {
  const onRun = vi.fn();
  render(<Editor initial={[filled()]} onRun={onRun} />);
  expect((screen.getByText("Run this suite").closest("button") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Save & canonicalize"));
  await waitFor(() => expect((screen.getByText("Run this suite").closest("button") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Run this suite"));
  expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: goldenSuite.id }));
  fireEvent.change(screen.getByLabelText("Version"), { target: { value: "banana" } });
  fireEvent.click(screen.getByText("Save & canonicalize"));
  await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());
  expect((screen.getByText("Export YAML").closest("button") as HTMLButtonElement).disabled).toBe(true);
});

it("preselects the requested suite rather than the first suite", () => {
  const suites = [goldenSuite, { ...goldenSuite, id: "second-suite" }];
  render(<NewEvaluation initialSuiteKey="local:second-suite@1.0.1" suites={suites} connections={[]} onStart={vi.fn()} onConnections={vi.fn()} />);
  const buttons = document.querySelectorAll(".suite-picker button");
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
});
