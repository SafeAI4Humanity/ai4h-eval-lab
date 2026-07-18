import { describe, expect, it } from "vitest";
import { assertKieCreditResponse, kieModelIds, normalizeProviderBaseUrl, ollamaThinkingSetting, parseOllamaModels, parseOpenAIModels } from "./providers";

describe("parseOllamaModels", () => {
  it("extracts installed model names from the Ollama tags response", () => {
    expect(parseOllamaModels({
      models: [
        { name: "qwen3.6:custom", model: "qwen3.6:custom", details: { parameter_size: "36.0B" } },
        { name: "gemma4:26b", model: "gemma4:26b", details: { parameter_size: "25.8B" } },
        { model: "gpt-oss:latest" }
      ]
    })).toEqual(["qwen3.6:custom", "gemma4:26b", "gpt-oss:latest"]);
  });

  it("ignores malformed model entries", () => {
    expect(parseOllamaModels({ models: [null, {}, { name: 42 }, { name: "valid:model" }] })).toEqual(["valid:model"]);
    expect(parseOllamaModels({})).toEqual([]);
  });
});

describe("parseOpenAIModels", () => {
  it("extracts model IDs from OpenRouter and OpenAI-compatible catalogs", () => {
    expect(parseOpenAIModels({ data: [{ id: "openai/gpt-4.1" }, { id: "anthropic/claude-sonnet-4" }] }))
      .toEqual(["openai/gpt-4.1", "anthropic/claude-sonnet-4"]);
  });

  it("ignores malformed catalog entries", () => {
    expect(parseOpenAIModels({ data: [null, {}, { id: 42 }, { id: "valid/model" }] })).toEqual(["valid/model"]);
  });
});

describe("kieModelIds", () => {
  it("exposes only the Kie.ai text models with implemented request adapters", () => {
    expect(kieModelIds()).toEqual(["gpt-5-2", "gemini-3-pro", "claude-opus-4-7"]);
  });
});

describe("assertKieCreditResponse", () => {
  it("accepts a successful Kie.ai credit response", () => {
    expect(() => assertKieCreditResponse({ code: 200, data: 42 })).not.toThrow();
  });

  it("rejects Kie.ai authentication errors returned with HTTP 200", () => {
    expect(() => assertKieCreditResponse({ code: 401, msg: "Unauthorized – Authentication failed." }))
      .toThrow("Unauthorized – Authentication failed.");
  });
});

describe("normalizeProviderBaseUrl", () => {
  it("removes OpenAI-compatible suffixes accidentally pasted into an Ollama base URL", () => {
    expect(normalizeProviderBaseUrl("ollama", "http://10.0.0.226:11434/v1/"))
      .toBe("http://10.0.0.226:11434");
    expect(normalizeProviderBaseUrl("ollama", "http://server.local:11434/api"))
      .toBe("http://server.local:11434");
  });

  it("preserves reverse-proxy paths and non-Ollama provider paths", () => {
    expect(normalizeProviderBaseUrl("ollama", "https://example.test/ollama"))
      .toBe("https://example.test/ollama");
    expect(normalizeProviderBaseUrl("openrouter", "https://openrouter.ai/api"))
      .toBe("https://openrouter.ai/api");
  });
});

describe("ollamaThinkingSetting", () => {
  it("disables thinking so evaluation token limits produce a final answer", () => {
    expect(ollamaThinkingSetting("qwen3.6:custom")).toBe(false);
    expect(ollamaThinkingSetting("deepseek-r1:latest")).toBe(false);
  });

  it("uses the lowest supported reasoning level for GPT-OSS", () => {
    expect(ollamaThinkingSetting("gpt-oss:latest")).toBe("low");
  });
});
