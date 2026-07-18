export type ProviderKind =
  | "ollama"
  | "openrouter"
  | "kie"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openai-compatible";

export type Connection = {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  modelHint?: string;
  enabled: boolean;
  status?: "connected" | "unavailable" | "untested";
  lastCheckedAt?: string;
  models?: string[];
};

export type CatalogSource = {
  id: string;
  name: string;
  url: string;
  official: boolean;
  enabled: boolean;
  status?: "ready" | "checking" | "error";
  lastCheckedAt?: string;
  error?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type Evaluator =
  | { type: "contains_any"; values: string[]; caseSensitive?: boolean }
  | { type: "contains_none"; values: string[]; caseSensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "non_empty"; minimumCharacters?: number }
  | { type: "valid_json" }
  | { type: "human_review"; rubric: string };

export type TestCase = {
  id: string;
  title: string;
  description?: string;
  messages: ChatMessage[];
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    seed?: number;
  };
  evaluators: Evaluator[];
};

export type TestSuite = {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  summary: string;
  category: string;
  risk: "low" | "moderate" | "high";
  license: string;
  author: string;
  tags: string[];
  sourceId: string;
  contentHash?: string;
  cases: TestCase[];
};

export type Catalog = {
  schemaVersion: 1;
  catalogVersion: string;
  publishedAt: string;
  suites: TestSuite[];
};

export type RunTarget = {
  id: string;
  connectionId: string;
  provider: ProviderKind;
  connectionName: string;
  model: string;
};

export type EvaluationOutcome = {
  evaluator: Evaluator;
  status: "pass" | "fail" | "review";
  explanation: string;
};

export type ReviewVerdict = "pass" | "fail";

export type ResultReview =
  | {
      id: string;
      reviewerType: "human";
      verdict: ReviewVerdict;
      reviewedAt: string;
      notes?: string;
    }
  | {
      id: string;
      reviewerType: "model";
      verdict: ReviewVerdict;
      reviewedAt: string;
      rationale: string;
      connectionId: string;
      connectionName: string;
      provider: ProviderKind;
      model: string;
      rawResponse: string;
      promptTokens?: number;
      completionTokens?: number;
    };

export type CaseResult = {
  id: string;
  suiteId: string;
  suiteVersion: string;
  suiteHash?: string;
  caseId: string;
  caseTitle: string;
  caseMessages?: ChatMessage[];
  target: RunTarget;
  response: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  outcomes: EvaluationOutcome[];
  status: "pass" | "fail" | "review" | "error";
  error?: string;
  reviews?: ResultReview[];
};

export type EvaluationRun = {
  id: string;
  name: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed" | "cancelled";
  suiteSnapshots: Array<Pick<TestSuite, "id" | "version" | "title" | "contentHash">>;
  targets: RunTarget[];
  results: CaseResult[];
};

export type ProviderResponse = {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
};
