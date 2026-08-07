import type { CaseResult, Connection, EvaluationRun, RunTarget, TestCase, TestSuite, TurnResult } from "../types";
import { evaluateResponse, summarizeStatus } from "./evaluators";
import { generateResponse } from "./providers";

export type RunProgress = {
  completed: number;
  total: number;
  latest?: CaseResult;
  current?: string;
};

export function testCaseRequestCount(testCase: TestCase): number {
  return "turns" in testCase ? testCase.turns.length : 1;
}

export function suiteRequestCount(suite: TestSuite): number {
  return suite.cases.reduce((sum, testCase) => sum + testCaseRequestCount(testCase), 0);
}

function optionalTotal(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

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
    suiteSnapshots: suites.map(({ id, version, title, category, risk, contentHash }) => ({ id, version, title, category, risk, contentHash })),
    targets,
    results: []
  };
  const total = suites.reduce((sum, suite) => sum + suiteRequestCount(suite), 0) * targets.length;
  let completedRequests = 0;
  onProgress({ ...run }, { completed: 0, total });

  for (const target of targets) {
    const connection = connections.find((candidate) => candidate.id === target.connectionId);
    if (!connection) continue;
    for (const suite of suites) {
      for (const testCase of suite.cases) {
        if (signal?.aborted) {
          run.status = "cancelled";
          run.completedAt = new Date().toISOString();
          onProgress({ ...run, results: [...run.results] }, { completed: completedRequests, total });
          return run;
        }

        const startedAt = new Date();
        let result: CaseResult;
        if ("turns" in testCase) {
          const history = [...(testCase.setup ?? [])];
          const turnResults: TurnResult[] = [];
          for (const [turnIndex, turn] of testCase.turns.entries()) {
            if (signal?.aborted) break;
            const turnStartedAt = new Date();
            const prompt = { role: "user" as const, content: turn.prompt };
            try {
              const response = await generateResponse(connection, {
                model: target.model,
                messages: [...history, prompt],
                temperature: turn.parameters?.temperature ?? testCase.parameters?.temperature,
                maxTokens: turn.parameters?.maxTokens ?? testCase.parameters?.maxTokens,
                seed: turn.parameters?.seed ?? testCase.parameters?.seed,
                signal
              });
              const turnCompletedAt = new Date();
              const outcomes = evaluateResponse(response.text, turn.evaluators);
              history.push(prompt, { role: "assistant", content: response.text });
              turnResults.push({
                turnId: turn.id,
                turnTitle: turn.title,
                turnNumber: turnIndex + 1,
                prompt: turn.prompt,
                response: response.text,
                startedAt: turnStartedAt.toISOString(),
                completedAt: turnCompletedAt.toISOString(),
                latencyMs: turnCompletedAt.getTime() - turnStartedAt.getTime(),
                promptTokens: response.promptTokens,
                completionTokens: response.completionTokens,
                outcomes,
                status: summarizeStatus(outcomes)
              });
            } catch (error) {
              const turnCompletedAt = new Date();
              history.push(prompt);
              turnResults.push({
                turnId: turn.id,
                turnTitle: turn.title,
                turnNumber: turnIndex + 1,
                prompt: turn.prompt,
                response: "",
                startedAt: turnStartedAt.toISOString(),
                completedAt: turnCompletedAt.toISOString(),
                latencyMs: turnCompletedAt.getTime() - turnStartedAt.getTime(),
                outcomes: [],
                status: "error",
                error: error instanceof Error ? error.message : "Request failed."
              });
            }
            completedRequests += 1;
            const latestTurn = turnResults[turnResults.length - 1];
            if (latestTurn.status === "error" || signal?.aborted) break;
            if (turnIndex < testCase.turns.length - 1) {
              onProgress(
                { ...run, results: [...run.results] },
                { completed: completedRequests, total, current: `${testCase.title} · stage ${turnIndex + 1} of ${testCase.turns.length}` }
              );
            }
          }

          const completedAt = new Date();
          const outcomes = turnResults.flatMap((turn) => turn.outcomes);
          const failedTurn = turnResults.find((turn) => turn.status === "fail");
          const errorTurn = turnResults.find((turn) => turn.status === "error");
          const cancelled = Boolean(signal?.aborted && turnResults.length < testCase.turns.length);
          const finalResponse = [...turnResults].reverse().find((turn) => turn.response)?.response ?? "";
          result = {
            id: crypto.randomUUID(),
            suiteId: suite.id,
            suiteVersion: suite.version,
            suiteHash: suite.contentHash,
            caseId: testCase.id,
            caseTitle: testCase.title,
            caseMessages: history,
            target,
            response: finalResponse,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            latencyMs: completedAt.getTime() - startedAt.getTime(),
            promptTokens: optionalTotal(turnResults.map((turn) => turn.promptTokens)),
            completionTokens: optionalTotal(turnResults.map((turn) => turn.completionTokens)),
            outcomes,
            status: errorTurn || cancelled ? "error" : summarizeStatus(outcomes),
            ...(errorTurn || cancelled ? { error: errorTurn?.error ?? "Evaluation cancelled before all stages completed." } : {}),
            executionType: "multi_turn",
            outcomePolicy: testCase.outcomePolicy,
            turnResults,
            ...(failedTurn ? { firstFailedTurn: failedTurn.turnNumber } : {})
          };
        } else try {
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
            status: summarizeStatus(outcomes),
            executionType: "single_turn"
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
            error: error instanceof Error ? error.message : "Request failed.",
            executionType: "single_turn"
          };
        }
        if (!("turns" in testCase)) completedRequests += 1;
        run.results.push(result);
        onProgress({ ...run, results: [...run.results] }, { completed: completedRequests, total, latest: result });
        if (signal?.aborted) {
          run.status = "cancelled";
          run.completedAt = new Date().toISOString();
          onProgress({ ...run, results: [...run.results] }, { completed: completedRequests, total, latest: result });
          return run;
        }
      }
    }
  }

  run.status = "completed";
  run.completedAt = new Date().toISOString();
  onProgress({ ...run, results: [...run.results] }, { completed: completedRequests, total });
  return run;
}

export function runSummary(run: EvaluationRun): { pass: number; fail: number; review: number; error: number } {
  return run.results.reduce(
    (summary, result) => ({ ...summary, [result.status]: summary[result.status] + 1 }),
    { pass: 0, fail: 0, review: 0, error: 0 }
  );
}
