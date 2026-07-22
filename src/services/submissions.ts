import type {
  CaseResult,
  EvaluationOutcome,
  EvaluationRun,
  ProviderKind,
  ResultReview,
  TestSuite
} from "../types";

export type PublicationMetadata = {
  submitter?: string;
  notes?: string;
};

export type PublishedTarget = {
  provider: ProviderKind;
  model: string;
};

export type PublishedReview =
  | Pick<Extract<ResultReview, { reviewerType: "human" }>, "id" | "reviewerType" | "verdict" | "reviewedAt" | "notes">
  | Pick<Extract<ResultReview, { reviewerType: "model" }>, "id" | "reviewerType" | "verdict" | "reviewedAt" | "rationale" | "provider" | "model" | "rawResponse" | "promptTokens" | "completionTokens">;

export type PublishedCaseResult = {
  id: string;
  suiteId: string;
  suiteVersion: string;
  suiteHash: string;
  caseId: string;
  caseTitle: string;
  caseMessages: NonNullable<CaseResult["caseMessages"]>;
  target: PublishedTarget;
  response: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  outcomes: EvaluationOutcome[];
  status: CaseResult["status"];
  error?: string;
  reviews?: PublishedReview[];
};

export type EvaluationSubmission = {
  schemaVersion: 1;
  submissionId: string;
  submittedAt: string;
  organization: "Safe AI for Humanity Foundation";
  app: { name: "AI4H Eval Lab"; version: string };
  consent: { publicRelease: true; includeRawResponses: true; includeReviews: true };
  provenance: { submitter?: string; notes?: string };
  run: {
    id: string;
    name: string;
    createdAt: string;
    completedAt: string;
    status: "completed";
    suiteSnapshots: Array<{
      id: string;
      version: string;
      title: string;
      category: string;
      risk: TestSuite["risk"];
      contentHash: string;
    }>;
    targets: PublishedTarget[];
    results: PublishedCaseResult[];
  };
};

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

function matchingSuite(snapshot: EvaluationRun["suiteSnapshots"][number], suites: TestSuite[]): TestSuite | undefined {
  return suites.find((suite) => suite.id === snapshot.id && suite.version === snapshot.version && (!snapshot.contentHash || suite.contentHash === snapshot.contentHash))
    ?? suites.find((suite) => suite.id === snapshot.id && suite.version === snapshot.version);
}

export function publicationIssues(run: EvaluationRun, suites: TestSuite[]): string[] {
  const issues: string[] = [];
  if (run.status !== "completed" || !run.completedAt) issues.push("Only completed evaluation runs can be published.");
  if (!run.results.length) issues.push("The run does not contain any case results.");
  if (!run.name.trim() || run.name.length > 300) issues.push("The run name must be between 1 and 300 characters for publication.");
  if (run.targets.some((target) => !target.model.trim() || target.model.length > 300)) issues.push("A model identifier is missing or longer than 300 characters.");

  for (const snapshot of run.suiteSnapshots) {
    const suite = matchingSuite(snapshot, suites);
    const hash = snapshot.contentHash;
    if (!snapshot.category && !suite?.category) issues.push(`${snapshot.title} is missing category metadata.`);
    if (!snapshot.risk && !suite?.risk) issues.push(`${snapshot.title} is missing risk metadata.`);
    if (!hash || !sha256Pattern.test(hash)) issues.push(`${snapshot.title} does not have a release-grade SHA-256 suite hash.`);
  }

  for (const result of run.results) {
    const snapshot = run.suiteSnapshots.find((candidate) => candidate.id === result.suiteId && candidate.version === result.suiteVersion);
    if (!result.caseMessages?.length) issues.push(`${result.caseTitle} is missing its original test messages.`);
    if (!result.suiteHash || !sha256Pattern.test(result.suiteHash)) issues.push(`${result.caseTitle} is missing a release-grade suite hash.`);
    if (snapshot?.contentHash && result.suiteHash && snapshot.contentHash !== result.suiteHash) issues.push(`${result.caseTitle} does not match its suite snapshot hash.`);
    if (result.response.length > 200_000) issues.push(`${result.caseTitle} has a response that exceeds the public submission size limit.`);
    if (result.outcomes.some((outcome) => outcome.explanation.length > 4_000)) issues.push(`${result.caseTitle} has evaluator evidence that exceeds the public submission size limit.`);
    if (result.reviews?.some((review) => review.reviewerType === "human" && (review.notes?.length ?? 0) > 10_000)) issues.push(`${result.caseTitle} has human review notes that exceed the public submission size limit.`);
    if (result.reviews?.some((review) => review.reviewerType === "model" && (review.rationale.length > 20_000 || review.rawResponse.length > 100_000))) issues.push(`${result.caseTitle} has model-assisted review evidence that exceeds the public submission size limit.`);
  }

  return [...new Set(issues)];
}

function publishReview(review: ResultReview): PublishedReview {
  if (review.reviewerType === "human") {
    return {
      id: review.id,
      reviewerType: review.reviewerType,
      verdict: review.verdict,
      reviewedAt: review.reviewedAt,
      ...(review.notes ? { notes: review.notes } : {})
    };
  }
  return {
    id: review.id,
    reviewerType: review.reviewerType,
    verdict: review.verdict,
    reviewedAt: review.reviewedAt,
    rationale: review.rationale,
    provider: review.provider,
    model: review.model,
    rawResponse: review.rawResponse,
    ...(review.promptTokens === undefined ? {} : { promptTokens: review.promptTokens }),
    ...(review.completionTokens === undefined ? {} : { completionTokens: review.completionTokens })
  };
}

function publishResult(result: CaseResult): PublishedCaseResult {
  return {
    id: result.id,
    suiteId: result.suiteId,
    suiteVersion: result.suiteVersion,
    suiteHash: result.suiteHash as string,
    caseId: result.caseId,
    caseTitle: result.caseTitle,
    caseMessages: result.caseMessages as NonNullable<CaseResult["caseMessages"]>,
    target: { provider: result.target.provider, model: result.target.model },
    response: result.response,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    latencyMs: result.latencyMs,
    ...(result.promptTokens === undefined ? {} : { promptTokens: result.promptTokens }),
    ...(result.completionTokens === undefined ? {} : { completionTokens: result.completionTokens }),
    outcomes: result.outcomes,
    status: result.status,
    ...(result.error ? { error: "Request failed; local diagnostic details were excluded from this public bundle." } : {}),
    ...(result.reviews?.length ? { reviews: result.reviews.map(publishReview) } : {})
  };
}

export function buildEvaluationSubmission(
  run: EvaluationRun,
  suites: TestSuite[],
  metadata: PublicationMetadata,
  appVersion: string,
  options: { submissionId?: string; submittedAt?: string } = {}
): EvaluationSubmission {
  const issues = publicationIssues(run, suites);
  if (issues.length) throw new Error(issues.join(" "));

  const suiteSnapshots = run.suiteSnapshots.map((snapshot) => {
    const suite = matchingSuite(snapshot, suites);
    return {
      id: snapshot.id,
      version: snapshot.version,
      title: snapshot.title,
      category: snapshot.category ?? suite?.category as string,
      risk: snapshot.risk ?? suite?.risk as TestSuite["risk"],
      contentHash: snapshot.contentHash as string
    };
  });

  return {
    schemaVersion: 1,
    submissionId: options.submissionId ?? crypto.randomUUID(),
    submittedAt: options.submittedAt ?? new Date().toISOString(),
    organization: "Safe AI for Humanity Foundation",
    app: { name: "AI4H Eval Lab", version: appVersion },
    consent: { publicRelease: true, includeRawResponses: true, includeReviews: true },
    provenance: {
      ...(metadata.submitter?.trim() ? { submitter: metadata.submitter.trim() } : {}),
      ...(metadata.notes?.trim() ? { notes: metadata.notes.trim() } : {})
    },
    run: {
      id: run.id,
      name: run.name,
      createdAt: run.createdAt,
      completedAt: run.completedAt as string,
      status: "completed",
      suiteSnapshots,
      targets: run.targets.map((target) => ({ provider: target.provider, model: target.model })),
      results: run.results.map(publishResult)
    }
  };
}

export function submissionFileName(submission: EvaluationSubmission): string {
  return `${submission.submissionId}.json`;
}
