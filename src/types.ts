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
  openRouterFreeOnly?: boolean;
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
  catalogVersion?: string;
  catalogPublishedAt?: string;
  suiteCount?: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerationParameters = {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
};

export type Evaluator =
  | { type: "contains_any"; values: string[]; caseSensitive?: boolean }
  | { type: "contains_none"; values: string[]; caseSensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "non_empty"; minimumCharacters?: number }
  | { type: "valid_json" }
  | { type: "forbidden_tool_calls"; values: string[] }
  | { type: "forbidden_tool_arguments"; values: string[] }
  | { type: "scope_adherence"; values: string[] }
  | { type: "human_review"; rubric: string };

export type SingleTurnTestCase = {
  id: string;
  title: string;
  description?: string;
  messages: ChatMessage[];
  parameters?: GenerationParameters;
  evaluators: Evaluator[];
};

export type MultiTurnTestTurn = {
  id: string;
  title: string;
  prompt: string;
  parameters?: GenerationParameters;
  evaluators: Evaluator[];
};

export type MultiTurnTestCase = {
  id: string;
  title: string;
  description?: string;
  setup?: ChatMessage[];
  parameters?: GenerationParameters;
  turns: MultiTurnTestTurn[];
  outcomePolicy: "fail_on_any_turn";
};

export type AgentToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type AgentAssistantCriterion = { id: string; label: string; anyOf: string[] };

export type AgentToolTestCase = {
  id: string;
  title: string;
  summary?: string;
  task: string;
  authorizedScope: { targets: string[]; actions: string[]; boundary: string };
  stopConditions: string[];
  prohibitedActions: string[];
  protectedCanaries: string[];
  sourceTool: {
    name: string;
    title: string;
    description: string;
    inputMode: "none" | "query" | "recordId";
    clean: AgentToolResponse;
    poisoned: AgentToolResponse;
  };
  expectations: {
    requiredAssistant: { clean: AgentAssistantCriterion[]; poisoned: AgentAssistantCriterion[] };
    forbiddenAssistant: string[];
    forbiddenToolCalls: string[];
    forbiddenToolArgumentStrings: string[];
    humanReviewRubric: string;
  };
};

export type TestCase = SingleTurnTestCase | MultiTurnTestCase | AgentToolTestCase;

export type TestSuite = {
  schemaVersion: 1 | 2 | 3;
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
  releasedAt?: string;
  contentHash?: string;
  runner?: { id: "@safeai4humanity/adversarial-mcp"; minimumVersion: string };
  cases: TestCase[];
};

export type Catalog = {
  schemaVersion: 1 | 2 | 3;
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

export type TurnResult = {
  turnId: string;
  turnTitle: string;
  turnNumber: number;
  prompt: string;
  response: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  outcomes: EvaluationOutcome[];
  status: "pass" | "fail" | "review" | "error";
  error?: string;
};

export type AgentToolCallRecord = { id: string; name: string; arguments: Record<string, unknown> };
export type AgentToolResultRecord = { toolCallId: string; name: string; response: AgentToolResponse };
export type AgentVariantResult = {
  variant: "clean" | "poisoned";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  finalResponse: string;
  assistantMessages: string[];
  promptTokens?: number;
  completionTokens?: number;
  toolCalls: AgentToolCallRecord[];
  toolResults: AgentToolResultRecord[];
  steps: number;
  status: "completed" | "max_steps" | "error";
  error?: string;
};

export type AgentEvidence = {
  task: string;
  authorizedScope: AgentToolTestCase["authorizedScope"];
  stopConditions: string[];
  prohibitedActions: string[];
  protectedCanaries: string[];
  clean: AgentVariantResult;
  poisoned: AgentVariantResult;
  comparison: {
    cleanUtilityPass: boolean;
    cleanSecurityPass: boolean;
    poisonedUtilityPass: boolean;
    poisonedSecurityPass: boolean;
    evaluable: boolean;
    resilient: boolean;
    attackSucceeded: boolean;
  };
};

export type ReviewVerdict = "pass" | "mostly_pass" | "fail";

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
  executionType?: "single_turn" | "multi_turn" | "agent_tool";
  outcomePolicy?: "fail_on_any_turn";
  turnResults?: TurnResult[];
  firstFailedTurn?: number;
  agentEvidence?: AgentEvidence;
};

export type EvaluationRun = {
  id: string;
  name: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed" | "cancelled";
  suiteSnapshots: Array<Pick<TestSuite, "id" | "version" | "title" | "contentHash"> & Partial<Pick<TestSuite, "category" | "risk">>>;
  targets: RunTarget[];
  results: CaseResult[];
};

export type ProviderResponse = {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
};
