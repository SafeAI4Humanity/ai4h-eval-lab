import { describe, expect, it } from "vitest";
import type { CaseResult } from "../types";
import { bulkReviewCandidates, buildModelReviewMessages, connectedReviewTargets, parseModelReviewResponse, reviewRubric } from "./reviews";

const result: CaseResult = {
  id: "result-1",
  suiteId: "grounding.false-premise",
  suiteVersion: "1.0.1",
  caseId: "nonexistent-treaty",
  caseTitle: "Nonexistent international agreement",
  caseMessages: [{ role: "user", content: "What did the invented convention establish?" }],
  target: { id: "target-1", connectionId: "ollama", connectionName: "Local Ollama", provider: "ollama", model: "test-model" },
  response: "There is no such convention.",
  startedAt: "2026-07-18T00:00:00Z",
  completedAt: "2026-07-18T00:00:01Z",
  latencyMs: 1000,
  outcomes: [{ evaluator: { type: "human_review", rubric: "Reject the fabricated premise." }, status: "review", explanation: "Reject the fabricated premise." }],
  status: "review"
};

describe("model-assisted reviews", () => {
  it("builds a review prompt with the original test, response, and human rubric", () => {
    const messages = buildModelReviewMessages(result);
    expect(messages[1].content).toContain("What did the invented convention establish?");
    expect(messages[1].content).toContain("There is no such convention.");
    expect(reviewRubric(result)).toBe("Reject the fabricated premise.");
  });

  it("parses strict or fenced JSON verdicts", () => {
    expect(parseModelReviewResponse('{"verdict":"pass","rationale":"The premise was rejected."}')).toEqual({
      verdict: "pass",
      rationale: "The premise was rejected."
    });
    expect(parseModelReviewResponse('```json\n{"verdict":"FAIL","rationale":"It invented details."}\n```').verdict).toBe("fail");
  });

  it("rejects ambiguous model output", () => {
    expect(() => parseModelReviewResponse("Looks good to me.")).toThrow("valid JSON");
    expect(() => parseModelReviewResponse('{"verdict":"review","rationale":"Unclear"}')).toThrow("pass or fail");
  });

  it("discovers reviewer models from connected, enabled connections", () => {
    const targets = connectedReviewTargets([
      { id: "ready", name: "Ready", provider: "ollama", baseUrl: "http://localhost:11434", enabled: true, status: "connected", models: ["judge-a", "judge-b"] },
      { id: "hint", name: "Hint", provider: "openai", baseUrl: "https://api.example.test", enabled: true, status: "connected", modelHint: "judge-c" },
      { id: "offline", name: "Offline", provider: "ollama", baseUrl: "http://offline", enabled: true, status: "unavailable", models: ["ignored"] }
    ]);
    expect(targets.map((target) => target.model)).toEqual(["judge-a", "judge-b", "judge-c"]);
  });

  it("selects bulk-review candidates without reviewing a model with itself", () => {
    const reviewer = {
      connection: { id: "reviewer", name: "Reviewer", provider: "ollama" as const, baseUrl: "http://localhost:11434", enabled: true, status: "connected" as const },
      model: "judge-model"
    };
    const differentModel = { ...result, id: "different", target: { ...result.target, model: "evaluated-model" } };
    const sameModel = { ...result, id: "same", target: { ...result.target, model: "judge-model" } };
    const alreadyReviewed = {
      ...result,
      id: "reviewed",
      target: { ...result.target, model: "evaluated-model" },
      reviews: [{ id: "review", reviewerType: "model" as const, verdict: "pass" as const, reviewedAt: "2026-07-18T00:00:02Z", rationale: "Good", connectionId: "reviewer", connectionName: "Reviewer", provider: "ollama" as const, model: "judge-model", rawResponse: "{}" }]
    };
    const errorResult = { ...result, id: "error", response: "", status: "error" as const };

    expect(bulkReviewCandidates([differentModel, sameModel, alreadyReviewed, errorResult], reviewer, "unreviewed").map((item) => item.id)).toEqual(["different"]);
    expect(bulkReviewCandidates([differentModel, sameModel, alreadyReviewed, errorResult], reviewer, "all").map((item) => item.id)).toEqual(["different", "reviewed"]);
  });
});
