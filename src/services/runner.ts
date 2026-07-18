import type { CaseResult, Connection, EvaluationRun, RunTarget, TestSuite } from "../types";
import { evaluateResponse, summarizeStatus } from "./evaluators";
import { generateResponse } from "./providers";

export type RunProgress = {
  completed: number;
  total: number;
  latest?: CaseResult;
};

export async function executeRun(
  name: string,
  suites: TestSuite[],
  targets: RunTarget[],
  connections: Connection[],
  onProgress: (run: EvaluationRun, progress: RunProgress) => void,
  signal?: AbortSignal
): Promise<EvaluationRun> {
  const run: EvaluationRun = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    status: "running",
    suiteSnapshots: suites.map(({ id, version, title, contentHash }) => ({ id, version, title, contentHash })),
    targets,
    results: []
  };
  const total = suites.reduce((sum, suite) => sum + suite.cases.length, 0) * targets.length;
  onProgress({ ...run }, { completed: 0, total });

  for (const target of targets) {
    const connection = connections.find((candidate) => candidate.id === target.connectionId);
    if (!connection) continue;
    for (const suite of suites) {
      for (const testCase of suite.cases) {
        if (signal?.aborted) {
          run.status = "cancelled";
          run.completedAt = new Date().toISOString();
          onProgress({ ...run, results: [...run.results] }, { completed: run.results.length, total });
          return run;
        }

        const startedAt = new Date();
        let result: CaseResult;
        try {
          const response = await generateResponse(connection, {
            model: target.model,
            messages: testCase.messages,
            temperature: testCase.parameters?.temperature,
            maxTokens: testCase.parameters?.maxTokens,
            seed: testCase.parameters?.seed,
            signal
          });
          const completedAt = new Date();
          const outcomes = evaluateResponse(response.text, testCase.evaluators);
          result = {
            id: crypto.randomUUID(),
            suiteId: suite.id,
            suiteVersion: suite.version,
            suiteHash: suite.contentHash,
            caseId: testCase.id,
            caseTitle: testCase.title,
            caseMessages: testCase.messages,
            target,
            response: response.text,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            latencyMs: completedAt.getTime() - startedAt.getTime(),
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            outcomes,
            status: summarizeStatus(outcomes)
          };
        } catch (error) {
          const completedAt = new Date();
          result = {
            id: crypto.randomUUID(),
            suiteId: suite.id,
            suiteVersion: suite.version,
            suiteHash: suite.contentHash,
            caseId: testCase.id,
            caseTitle: testCase.title,
            caseMessages: testCase.messages,
            target,
            response: "",
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            latencyMs: completedAt.getTime() - startedAt.getTime(),
            outcomes: [],
            status: "error",
            error: error instanceof Error ? error.message : "Request failed."
          };
        }
        run.results.push(result);
        onProgress({ ...run, results: [...run.results] }, { completed: run.results.length, total, latest: result });
      }
    }
  }

  run.status = "completed";
  run.completedAt = new Date().toISOString();
  onProgress({ ...run, results: [...run.results] }, { completed: total, total });
  return run;
}

export function runSummary(run: EvaluationRun): { pass: number; fail: number; review: number; error: number } {
  return run.results.reduce(
    (summary, result) => ({ ...summary, [result.status]: summary[result.status] + 1 }),
    { pass: 0, fail: 0, review: 0, error: 0 }
  );
}
