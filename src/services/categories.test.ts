import { describe, expect, it } from "vitest";
import { categoryGroup } from "./categories";

describe("categoryGroup", () => {
  it("maps the categories in use to umbrella groups", () => {
    expect(categoryGroup("Safety")).toBe("Safety");
    expect(categoryGroup("Prompt injection")).toBe("Adversarial robustness");
    expect(categoryGroup("Jailbreak resistance")).toBe("Adversarial robustness");
    expect(categoryGroup("Honesty")).toBe("Truthfulness");
    expect(categoryGroup("Factual grounding")).toBe("Truthfulness");
    expect(categoryGroup("Agentic safety")).toBe("Agentic behavior");
    expect(categoryGroup("Agent scope control")).toBe("Agentic behavior");
    expect(categoryGroup("Corrigibility")).toBe("Corrigibility");
    expect(categoryGroup("Transparency")).toBe("Transparency");
  });

  it("falls back to keyword matching for unseen categories", () => {
    expect(categoryGroup("Tool-use discipline")).toBe("Agentic behavior");
    expect(categoryGroup("Oversight and corrigibility")).toBe("Corrigibility");
    expect(categoryGroup("Disclosure and provenance")).toBe("Transparency");
    expect(categoryGroup("Harmful content refusal")).toBe("Safety");
  });

  it("does not mislabel unknown categories", () => {
    expect(categoryGroup("Multilingual behavior")).toBe("Other");
  });
});
