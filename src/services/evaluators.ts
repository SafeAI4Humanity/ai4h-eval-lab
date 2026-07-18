import type { EvaluationOutcome, Evaluator } from "../types";

export function evaluateResponse(response: string, evaluators: Evaluator[]): EvaluationOutcome[] {
  return evaluators.map((evaluator) => evaluateOne(response, evaluator));
}

function evaluateOne(response: string, evaluator: Evaluator): EvaluationOutcome {
  if (evaluator.type === "human_review") {
    return { evaluator, status: "review", explanation: evaluator.rubric };
  }

  if (evaluator.type === "non_empty") {
    const minimum = evaluator.minimumCharacters ?? 1;
    const passed = response.trim().length >= minimum;
    return {
      evaluator,
      status: passed ? "pass" : "fail",
      explanation: passed ? `Response has at least ${minimum} characters.` : `Response is shorter than ${minimum} characters.`
    };
  }

  if (evaluator.type === "valid_json") {
    try {
      JSON.parse(response);
      return { evaluator, status: "pass", explanation: "Response is valid JSON." };
    } catch {
      return { evaluator, status: "fail", explanation: "Response is not valid JSON." };
    }
  }

  if (evaluator.type === "regex") {
    const passed = new RegExp(evaluator.pattern, evaluator.flags).test(response);
    return {
      evaluator,
      status: passed ? "pass" : "fail",
      explanation: passed ? "Response matched the required pattern." : "Response did not match the required pattern."
    };
  }

  const haystack = evaluator.caseSensitive ? response : response.toLocaleLowerCase();
  const values = evaluator.caseSensitive ? evaluator.values : evaluator.values.map((value) => value.toLocaleLowerCase());

  if (evaluator.type === "contains_any") {
    const match = values.find((value) => haystack.includes(value));
    return {
      evaluator,
      status: match ? "pass" : "fail",
      explanation: match
        ? `Found expected indicator: “${match}”.`
        : `No expected indicator was found. Expected any of: ${values.map((value) => `“${value}”`).join(", ")}.`
    };
  }

  const match = values.find((value) => haystack.includes(value));
  return {
    evaluator,
    status: match ? "fail" : "pass",
    explanation: match ? `Found excluded indicator: “${match}”.` : "No excluded indicators were found."
  };
}

export function summarizeStatus(outcomes: EvaluationOutcome[]): "pass" | "fail" | "review" {
  if (outcomes.some((outcome) => outcome.status === "fail")) return "fail";
  if (outcomes.some((outcome) => outcome.status === "review")) return "review";
  return "pass";
}
