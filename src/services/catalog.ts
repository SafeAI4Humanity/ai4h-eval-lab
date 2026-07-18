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
const suiteSchema = z.object({
  schemaVersion: z.literal(1),
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
  contentHash: z.string().optional(),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      messages: z.array(messageSchema).min(1),
      parameters: z
        .object({ temperature: z.number().optional(), maxTokens: z.number().int().positive().optional(), seed: z.number().int().optional() })
        .optional(),
      evaluators: z.array(evaluatorSchema).min(1)
    })
  ).min(1)
});
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string(),
  publishedAt: z.string(),
  suites: z.array(suiteSchema)
});

export async function loadSource(source: CatalogSource): Promise<Catalog> {
  const response = await appFetch(source.url, { headers: { Accept: "application/json" } });
  const parsed = catalogSchema.parse(await readJson(response));
  return {
    ...parsed,
    suites: parsed.suites.map((suite) => ({ ...suite, sourceId: source.id })) as TestSuite[]
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
