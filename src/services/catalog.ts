import { z } from "zod";
import { bundledCatalog } from "../data/bundledCatalog";
import type { Catalog, CatalogSource, TestSuite } from "../types";
import { appFetch, readJson } from "./http";

const messageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().min(1) });
const evaluatorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contains_any"), values: z.array(z.string()).min(1), caseSensitive: z.boolean().optional() }),
  z.object({ type: z.literal("contains_none"), values: z.array(z.string()).min(1), caseSensitive: z.boolean().optional() }),
  z.object({ type: z.literal("regex"), pattern: z.string(), flags: z.string().optional() }),
  z.object({ type: z.literal("non_empty"), minimumCharacters: z.number().int().positive().optional() }),
  z.object({ type: z.literal("valid_json") }),
  z.object({ type: z.literal("human_review"), rubric: z.string().min(1) })
]);
const parametersSchema = z
  .object({ temperature: z.number().optional(), maxTokens: z.number().int().positive().optional(), seed: z.number().int().optional() });
const suiteMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  version: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  risk: z.enum(["low", "moderate", "high"]),
  license: z.string(),
  author: z.string(),
  tags: z.array(z.string()),
  sourceId: z.string().optional().default("external"),
  contentHash: z.string().optional()
});
const singleTurnSuiteSchema = suiteMetadataSchema.extend({
  schemaVersion: z.literal(1),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      messages: z.array(messageSchema).min(1),
      parameters: parametersSchema.optional(),
      evaluators: z.array(evaluatorSchema).min(1)
    })
  ).min(1)
});
const multiTurnSuiteSchema = suiteMetadataSchema.extend({
  schemaVersion: z.literal(2),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      setup: z.array(messageSchema).optional(),
      parameters: parametersSchema.optional(),
      outcomePolicy: z.literal("fail_on_any_turn"),
      turns: z.array(z.object({
        id: z.string(),
        title: z.string(),
        prompt: z.string().min(1),
        parameters: parametersSchema.optional(),
        evaluators: z.array(evaluatorSchema).min(1)
      })).min(2).max(8)
    })
  ).min(1)
});
const agentToolResponseSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string().min(1) })).min(1),
  structuredContent: z.record(z.unknown()).optional(),
  isError: z.boolean().optional()
});
const agentCriterionSchema = z.object({ id: z.string().min(1), label: z.string().min(1), anyOf: z.array(z.string().min(1)).min(1) });
const agentSuiteSchema = suiteMetadataSchema.extend({
  schemaVersion: z.literal(3),
  runner: z.object({
    id: z.literal("@safeai4humanity/adversarial-mcp"),
    minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/)
  }),
  cases: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().optional(),
    task: z.string().min(1),
    authorizedScope: z.object({
      targets: z.array(z.string().min(1)).min(1),
      actions: z.array(z.string().min(1)).min(1),
      boundary: z.string().min(1)
    }),
    stopConditions: z.array(z.string().min(1)).min(1),
    prohibitedActions: z.array(z.string().min(1)).min(1),
    protectedCanaries: z.array(z.string().min(1)),
    sourceTool: z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]*$/),
      title: z.string().min(1),
      description: z.string().min(1),
      inputMode: z.enum(["none", "query", "recordId"]),
      clean: agentToolResponseSchema,
      poisoned: agentToolResponseSchema
    }),
    expectations: z.object({
      requiredAssistant: z.object({
        clean: z.array(agentCriterionSchema),
        poisoned: z.array(agentCriterionSchema)
      }),
      forbiddenAssistant: z.array(z.string()),
      forbiddenToolCalls: z.array(z.string()),
      forbiddenToolArgumentStrings: z.array(z.string()),
      humanReviewRubric: z.string().min(1)
    })
  })).min(1)
});
const catalogSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  catalogVersion: z.string(),
  publishedAt: z.string(),
  suites: z.array(z.discriminatedUnion("schemaVersion", [singleTurnSuiteSchema, multiTurnSuiteSchema, agentSuiteSchema]))
});
const agentHarnessVersion = "0.2.0";

function supportsAgentHarness(minimumVersion: string): boolean {
  const current = agentHarnessVersion.split(".").map(Number);
  const minimum = minimumVersion.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

export async function loadSource(source: CatalogSource): Promise<Catalog> {
  const response = await appFetch(source.url, { headers: { Accept: "application/json" } });
  return parseCatalog(await readJson(response), source.id);
}

export function parseCatalog(data: unknown, sourceId = "external"): Catalog {
  const parsed = catalogSchema.parse(data);
  for (const suite of parsed.suites) {
    if (suite.schemaVersion === 3 && !supportsAgentHarness(suite.runner.minimumVersion)) {
      throw new Error(`Agent suite '${suite.id}' requires harness ${suite.runner.minimumVersion} or newer; this app supports ${agentHarnessVersion}.`);
    }
  }
  return {
    ...parsed,
    suites: parsed.suites.map((suite) => ({ ...suite, sourceId })) as TestSuite[]
  };
}

export async function refreshCatalogs(sources: CatalogSource[]): Promise<{
  suites: TestSuite[];
  sources: CatalogSource[];
  updatedCount: number;
}> {
  const enabled = sources.filter((source) => source.enabled);
  const results = await Promise.allSettled(enabled.map(loadSource));
  const remoteSuites: TestSuite[] = [];
  let updatedCount = 0;

  const nextSources = sources.map((source) => {
    const index = enabled.findIndex((candidate) => candidate.id === source.id);
    if (index < 0) return source;
    const result = results[index];
    if (result.status === "fulfilled") {
      remoteSuites.push(...result.value.suites);
      updatedCount += result.value.suites.length;
      return { ...source, status: "ready" as const, lastCheckedAt: new Date().toISOString(), error: undefined };
    }
    return {
      ...source,
      status: "error" as const,
      lastCheckedAt: new Date().toISOString(),
      error: result.reason instanceof Error ? result.reason.message : "Catalog could not be loaded."
    };
  });

  const deduplicated = new Map<string, TestSuite>();
  [...bundledCatalog.suites, ...remoteSuites].forEach((suite) => deduplicated.set(`${suite.id}@${suite.version}`, suite));
  return { suites: [...deduplicated.values()], sources: nextSources, updatedCount };
}

export function bundledSuites(): TestSuite[] {
  return bundledCatalog.suites;
}
