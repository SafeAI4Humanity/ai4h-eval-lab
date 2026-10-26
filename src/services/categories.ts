export const CATEGORY_GROUPS = [
  "Safety",
  "Adversarial robustness",
  "Truthfulness",
  "Agentic behavior",
  "Corrigibility",
  "Transparency",
  "Other"
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

const EXPLICIT: Record<string, CategoryGroup> = {
  "safety": "Safety",
  "prompt injection": "Adversarial robustness",
  "jailbreak resistance": "Adversarial robustness",
  "honesty": "Truthfulness",
  "factual grounding": "Truthfulness",
  "agentic safety": "Agentic behavior",
  "agent scope control": "Agentic behavior",
  "corrigibility": "Corrigibility",
  "transparency": "Transparency"
};

// Umbrella grouping for display/filtering only — the suite's own category stays
// the authoritative metadata (submissions and run snapshots keep it verbatim).
export function categoryGroup(category: string): CategoryGroup {
  const key = category.toLowerCase().trim();
  if (EXPLICIT[key]) return EXPLICIT[key];
  if (key.includes("inject") || key.includes("jailbreak")) return "Adversarial robustness";
  if (key.includes("honest") || key.includes("ground") || key.includes("truth")) return "Truthfulness";
  if (key.includes("agent") || key.includes("tool")) return "Agentic behavior";
  if (key.includes("corrig")) return "Corrigibility";
  if (key.includes("transparen") || key.includes("disclos") || key.includes("provenance")) return "Transparency";
  if (key.includes("safety") || key.includes("harm")) return "Safety";
  return "Other";
}
