// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveRun } from "./App";
import { useEvaluationRuns } from "./hooks/useEvaluationRuns";
import { runModelReview } from "./services/reviews";
import { storage } from "./services/storage";
import type { CaseResult, Connection, EvaluationRun, ResultReview } from "./types";


vi.mock("./services/reviews", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/reviews")>(),
  runModelReview: vi.fn()
}));

const response: CaseResult = {
  id: "response-1", suiteId: "suite", suiteVersion: "1.0.0", caseId: "case-1", caseTitle: "First completed response",
  target: { id: "target", provider: "ollama", connectionId: "local", connectionName: "Local Ollama", model: "test-model" },
  response: "A recorded response to inspect.", caseMessages: [{ role: "user", content: "The original prompt." }],
  startedAt: "2026-11-12T12:00:00Z", completedAt: "2026-11-12T12:00:01Z", latencyMs: 1000,
  status: "fail", outcomes: [{ evaluator: { type: "non_empty" }, status: "pass", explanation: "Response is not empty." }]
};
const run: EvaluationRun = {
  id: "run-1", name: "In-progress evaluation", createdAt: response.startedAt, status: "running", suiteSnapshots: [], targets: [response.target], results: [response]
};
const second: CaseResult = { ...response, id: "response-2", caseId: "case-2", caseTitle: "Second completed response", response: "Another recorded response." };
const review: ResultReview = { id: "human-review", reviewerType: "human", verdict: "mostly_pass", reviewedAt: response.completedAt, notes: "Saved while running." };
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("lets the user inspect and review a response without stopping the run or losing notes to new results", () => {
  const onSaveReview = vi.fn();
  const onCancel = vi.fn();
  const props = { run, progress: { completed: 1, total: 3 }, connections: [], onSaveReview, onCancel, onResults: vi.fn() };
  const view = render(<LiveRun {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /First completed response/ }));
  expect(screen.getByText("The original prompt.")).toBeTruthy();
  expect(screen.getByText(response.response)).toBeTruthy();
  expect(screen.getByText("Response is not empty.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Reviewer notes (optional)"), { target: { value: "Saved while running." } });
  view.rerender(<LiveRun {...props} run={{ ...run, results: [response, second] }} progress={{ completed: 2, total: 3 }} />);
  expect((screen.getByLabelText("Reviewer notes (optional)") as HTMLTextAreaElement).value).toBe("Saved while running.");
  expect(screen.getByText("2 of 3 evaluation units complete")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mostly passed" }));
  fireEvent.click(screen.getByRole("button", { name: "Save human review" }));
  expect(onSaveReview).toHaveBeenCalledWith(run.id, response.id, expect.objectContaining({ verdict: "mostly_pass", notes: "Saved while running." }));
  expect(onCancel).not.toHaveBeenCalled();
});

it.each(["completed", "cancelled"] as const)("preserves live reviews through progress, %s, and reload", (status) => {
  const { result, unmount } = renderHook(useEvaluationRuns);
  act(() => result.current.receiveRun(run));
  act(() => result.current.saveResultReview(run.id, response.id, review));
  act(() => result.current.receiveRun({ ...run, results: [response, second] }));
  act(() => result.current.receiveRun({ ...run, results: [response, second], status }));
  expect(result.current.activeRun?.results[0].reviews).toEqual([review]);
  expect(result.current.activeRun?.results[0].status).toBe("fail");
  expect(storage.getRuns()[0].results[0].reviews).toEqual([review]);
  expect(storage.getRuns()[0].status).toBe(status);
  unmount();
  const reloaded = renderHook(useEvaluationRuns);
  expect(reloaded.result.current.runs[0].results[0].reviews).toEqual([review]);
});

it("preserves concurrent archived reviews and late model reviews at completion without duplicating them", () => {
  const archived = { ...run, id: "archived", status: "completed" as const };
  storage.setRuns([archived]);
  const { result } = renderHook(useEvaluationRuns);
  const modelReview: ResultReview = { id: "llm-review", reviewerType: "model", verdict: "pass", reviewedAt: response.completedAt, rationale: "Reviewed evidence.", connectionId: "reviewer", connectionName: "Reviewer", provider: "ollama", model: "judge", rawResponse: "{}" };
  act(() => {
    result.current.receiveRun(run);
    result.current.saveResultReview(archived.id, response.id, review);
    result.current.receiveRun({ ...run, status: "completed" });
    result.current.saveResultReview(run.id, response.id, modelReview);
    result.current.receiveRun({ ...run, status: "completed", results: [{ ...response, reviews: [modelReview] }] });
  });
  expect(result.current.runs.find((item) => item.id === archived.id)?.results[0].reviews).toEqual([review]);
  expect(result.current.activeRun?.results[0].reviews).toEqual([modelReview]);
});

it("saves a model-assisted review requested live even if the evaluation finishes first", async () => {
  let finishReview!: (review: ResultReview) => void;
  vi.mocked(runModelReview).mockReturnValueOnce(new Promise((resolve) => { finishReview = resolve; }));
  let feed!: (snapshot: EvaluationRun) => void;
  const connection: Connection = { id: "judge", name: "Review model", provider: "ollama", baseUrl: "http://localhost:11434", enabled: true, status: "connected", models: ["judge-model"] };
  function Harness() {
    const { activeRun, receiveRun, saveResultReview } = useEvaluationRuns();
    feed = receiveRun;
    return <LiveRun run={activeRun} progress={{ completed: activeRun?.results.length ?? 0, total: 2 }} connections={[connection]} onSaveReview={saveResultReview} onCancel={vi.fn()} onResults={vi.fn()} />;
  }
  render(<Harness />);
  act(() => feed(run));
  fireEvent.click(screen.getByRole("button", { name: /First completed response/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Use a connected LLM" }));
  fireEvent.click(screen.getByRole("button", { name: "Run model-assisted review" }));
  await waitFor(() => expect(runModelReview).toHaveBeenCalledWith(response, expect.objectContaining({ model: "judge-model" })));
  act(() => feed({ ...run, results: [response, second], status: "completed" }));
  const judged: ResultReview = { id: "live-model-review", reviewerType: "model", verdict: "pass", reviewedAt: response.completedAt, rationale: "Evidence inspected.", connectionId: connection.id, connectionName: connection.name, provider: connection.provider, model: "judge-model", rawResponse: "{}" };
  await act(async () => finishReview(judged));
  expect(screen.getByText("Evidence inspected.")).toBeTruthy();
  expect(storage.getRuns()[0].results[0].reviews).toEqual([judged]);
  expect(storage.getRuns()[0].results[0].status).toBe("fail");
});
