import { describe, expect, it } from "vitest";
import type { Connection } from "../types";
import {
  assertKieCreditResponse,
  emptyProviderResponseMessage,
  kieModelIds,
  normalizeProviderBaseUrl,
  ollamaNumPredict,
  ollamaThinkValue,
  openAiCompatibleMaxTokens,
  parseOllamaShowThinking,
  resolveReasoningEffort,
  supportedReasoningEfforts,
  parseAnthropicAgentTurn,
  parseAnthropicResponseEvidence,
  parseGeminiResponseEvidence,
  parseOllamaModels,
  parseOllamaResponseEvidence,
  parseOpenAiAgentTurn,
  parseOpenAIModels,
  parseOpenAiResponseEvidence,
  parseOpenRouterModels,
  providerResponseDiagnosticDetails
} from "./providers";

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

describe("parseOpenRouterModels", () => {
  const catalog = {
    data: [
      { id: "openrouter/free", pricing: { prompt: "0", completion: "0", request: "0" } },
      { id: "vendor/free-model", pricing: { prompt: 0, completion: 0 } },
      { id: "vendor/paid-output", pricing: { prompt: "0", completion: "0.000001", request: "0" } },
      { id: "vendor/paid-request", pricing: { prompt: "0", completion: "0", request: "0.01" } },
      { id: "vendor/unknown-price" },
      null
    ]
  };

  it("returns the complete valid OpenRouter catalog when the filter is off", () => {
    expect(parseOpenRouterModels(catalog)).toEqual([
      "openrouter/free",
      "vendor/free-model",
      "vendor/paid-output",
      "vendor/paid-request",
      "vendor/unknown-price"
    ]);
  });

  it("keeps only models with zero prompt, completion, and request pricing", () => {
    expect(parseOpenRouterModels(catalog, true)).toEqual(["openrouter/free", "vendor/free-model"]);
  });

  it("does not classify malformed or missing pricing as free", () => {
    expect(parseOpenRouterModels({ data: [{ id: "missing" }, { id: "bad", pricing: { prompt: "free", completion: "0" } }] }, true)).toEqual([]);
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

describe("resolveReasoningEffort", () => {
  const connection = { id: "c1", name: "c1", provider: "ollama", baseUrl: "http://localhost:11434", enabled: true } satisfies Connection;

  it("uses the connection setting when set", () => {
    expect(resolveReasoningEffort({ ...connection, reasoningEffort: "low" }, "qwen3.8:latest")).toBe("low");
  });

  it("returns undefined when unset so the model default applies", () => {
    expect(resolveReasoningEffort(connection, "qwen3.8:latest")).toBeUndefined();
  });

  it("returns undefined for models with no thinking control", () => {
    expect(resolveReasoningEffort({ ...connection, provider: "openai-compatible", reasoningEffort: "low" }, "gpt-4o")).toBeUndefined();
  });

  it("accepts scan-normalized boolean values for Ollama (the scan is authoritative)", () => {
    expect(resolveReasoningEffort({ ...connection, reasoningEffort: "on" }, "qwen3.8:latest")).toBe("on");
  });

  it("rejects an effort the target model does not support", () => {
    expect(() => resolveReasoningEffort({ ...connection, reasoningEffort: "none" }, "gpt-oss:120b")).not.toThrow(); // ollama accepts none
    expect(() => resolveReasoningEffort({ id: "c2", name: "c2", provider: "openai-compatible", baseUrl: "http://localhost:8000", enabled: true, reasoningEffort: "none" } satisfies Connection, "gpt-oss:120b")).toThrow(/not supported by gpt-oss:120b/);
  });
});

describe("ollamaThinkValue", () => {
  it("maps none to false, on to true, and passes effort strings through", () => {
    expect(ollamaThinkValue("none")).toBe(false);
    expect(ollamaThinkValue("on")).toBe(true);
    expect(ollamaThinkValue("low")).toBe("low");
  });
});

describe("ollamaNumPredict", () => {
  it("adds the thinking allowance on top of the answer budget unless effort is none", () => {
    expect(ollamaNumPredict(350, undefined)).toBe(1350);
    expect(ollamaNumPredict(350, "on")).toBe(1350);
    expect(ollamaNumPredict(350, "low")).toBe(1350);
    expect(ollamaNumPredict(350, "none")).toBe(350);
    expect(ollamaNumPredict(undefined, undefined)).toBe(1500);
  });
});

describe("supportedReasoningEfforts", () => {
  it("excludes none for GPT-OSS on generic OpenAI-compatible backends (vLLM Harmony rejects it)", () => {
    expect(supportedReasoningEfforts("openai-compatible", "gpt-oss:120b")).toEqual(["low", "medium", "high"]);
    expect(supportedReasoningEfforts("ollama", "gpt-oss:120b")).toEqual(["none", "low", "medium", "high"]);
  });

  it("offers levels for other reasoning models and nothing for non-reasoning models", () => {
    expect(supportedReasoningEfforts("openai-compatible", "qwen3.8:latest")).toEqual(["none", "low", "medium", "high"]);
    expect(supportedReasoningEfforts("openai-compatible", "gpt-4o")).toEqual([]);
  });

  it("recognizes OpenAI native reasoning families with family-accurate values (no none — thinking cannot be disabled)", () => {
    expect(supportedReasoningEfforts("openai", "o1-mini")).toEqual(["low", "high"]);
    expect(supportedReasoningEfforts("openai", "o3")).toEqual(["low", "medium", "high"]);
    expect(supportedReasoningEfforts("openai", "o4-mini")).toEqual(["low", "medium", "high"]);
    expect(supportedReasoningEfforts("openai", "gpt-5")).toEqual(["minimal", "low", "medium", "high"]);
    expect(supportedReasoningEfforts("openai", "gpt-5.1")).toEqual(["none", "low", "medium", "high"]);
    expect(supportedReasoningEfforts("openai", "gpt-5-pro")).toEqual(["high"]);
    expect(supportedReasoningEfforts("openrouter", "openai/o3")).toEqual(["low", "medium", "high"]);
  });
});

describe("parseOllamaShowThinking", () => {
  it("maps boolean thinking values to none/on", () => {
    expect(parseOllamaShowThinking({ thinking: { values: [false, true], default: true } })).toEqual({ values: ["none", "on"], default: "on" });
  });

  it("passes string effort values through", () => {
    expect(parseOllamaShowThinking({ thinking: { values: ["none", "low", "medium", "high"], default: "high" } })).toEqual({ values: ["none", "low", "medium", "high"], default: "high" });
  });

  it("returns null for models without thinking metadata", () => {
    expect(parseOllamaShowThinking({ capabilities: ["completion"] })).toBeNull();
    expect(parseOllamaShowThinking({})).toBeNull();
  });
});

describe("openAiCompatibleMaxTokens", () => {
  it("honors an explicit suite request", () => {
    expect(openAiCompatibleMaxTokens("qwen3.8:latest", 300)).toBe(300);
    expect(openAiCompatibleMaxTokens("qwen3.8:latest", 2000)).toBe(2000);
    expect(openAiCompatibleMaxTokens("gpt-5-2", 300)).toBe(300);
  });

  it("applies the larger fallback only when the suite declares no budget", () => {
    expect(openAiCompatibleMaxTokens("qwen3.8:latest", undefined)).toBe(1000);
    expect(openAiCompatibleMaxTokens("gpt-4o", undefined)).toBe(500);
    expect(openAiCompatibleMaxTokens("gpt-5-2", undefined)).toBe(1000); // GPT-5 is a reasoning family
  });
});

describe("provider response evidence", () => {
  it("captures OpenAI-compatible finish reasons, usage, and final content for scoring", () => {
    expect(parseOpenAiResponseEvidence({
      choices: [{ finish_reason: "stop", message: { content: "A final answer that must not be logged." } }],
      usage: { prompt_tokens: 12, completion_tokens: 9 }
    })).toEqual({
      text: "A final answer that must not be logged.",
      promptTokens: 12,
      completionTokens: 9,
      reasoningCharacters: 0,
      finishReason: "stop",
      toolCallCount: 0,
      textField: "choices[0].message.content"
    });
  });

  it("reduces response evidence to non-content diagnostic metadata", () => {
    const evidence = parseOpenAiResponseEvidence({
      choices: [{ finish_reason: "stop", message: { content: "Sensitive final response" } }],
      usage: { prompt_tokens: 12, completion_tokens: 9 }
    });
    const details = providerResponseDiagnosticDetails("openai-compatible", "test-model", 500, evidence, "text");
    expect(details).toMatchObject({
      provider: "openai-compatible",
      model: "test-model",
      contentCharacters: 24,
      reasoningCharacters: 0,
      finishReason: "stop",
      promptTokens: 12,
      completionTokens: 9,
      requestedMaxTokens: 500,
      textField: "choices[0].message.content"
    });
    expect(JSON.stringify(details)).not.toContain("Sensitive final response");
  });

  it("recognizes refusal text as a final OpenAI-compatible response", () => {
    expect(parseOpenAiResponseEvidence({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "I cannot help with that." } }] }))
      .toMatchObject({ text: "I cannot help with that.", textField: "choices[0].message.refusal" });
  });

  it("diagnoses reasoning that exhausted the output allowance before a final answer", () => {
    const evidence = parseOpenAiResponseEvidence({
      choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "r".repeat(2400) } }],
      usage: { completion_tokens: 500 }
    });
    expect(evidence).toMatchObject({ text: "", reasoningCharacters: 2400, finishReason: "length", completionTokens: 500, textField: "missing" });
    expect(emptyProviderResponseMessage("openai-compatible", evidence, 500))
      .toBe("OpenAI-compatible reached the 500-token output limit after 500 completion tokens without producing a final answer (2400 reasoning characters were returned). The response was not scored.");
  });

  it("captures safe response metadata for Ollama, Anthropic, and Gemini", () => {
    expect(parseOllamaResponseEvidence({ message: { content: "Done", thinking: "private" }, done_reason: "stop", eval_count: 4 }))
      .toMatchObject({ text: "Done", reasoningCharacters: 7, finishReason: "stop", completionTokens: 4 });
    expect(parseAnthropicResponseEvidence({ content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Done" }], stop_reason: "end_turn" }))
      .toMatchObject({ text: "Done", reasoningCharacters: 7, finishReason: "end_turn" });
    expect(parseGeminiResponseEvidence({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "private" }, { text: "Done" }] } }] }))
      .toMatchObject({ text: "Done", reasoningCharacters: 7, finishReason: "STOP" });
  });

  it("reports a successful but unrecognized response shape without inventing content", () => {
    const evidence = parseOpenAiResponseEvidence({ choices: [{ finish_reason: "stop", message: {} }] });
    expect(emptyProviderResponseMessage("openai-compatible", evidence, 500))
      .toBe("OpenAI-compatible returned HTTP 200 but no final text in a recognized response field (finish reason: stop; text field: missing). The response was not scored.");
  });
});

describe("agent tool-call response parsing", () => {
  it("normalizes OpenAI and Ollama-style function calls", () => {
    expect(parseOpenAiAgentTurn({
      message: { content: "", tool_calls: [{ function: { name: "read_fixture", arguments: { query: "status" } } }] },
      prompt_eval_count: 10,
      eval_count: 3
    })).toMatchObject({
      text: "",
      toolCalls: [{ name: "read_fixture", arguments: { query: "status" } }],
      promptTokens: 10,
      completionTokens: 3
    });
    expect(parseOpenAiAgentTurn({
      choices: [{ message: { content: null, tool_calls: [{ id: "call-1", function: { name: "probe_external_target", arguments: "{\"target\":\"fixture://outside\"}" } }] } }]
    }).toolCalls[0]).toEqual({ id: "call-1", name: "probe_external_target", arguments: { target: "fixture://outside" } });
  });

  it("normalizes Anthropic text and tool-use blocks", () => {
    expect(parseAnthropicAgentTurn({
      content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tool-1", name: "read_fixture", input: {} }],
      usage: { input_tokens: 12, output_tokens: 4 }
    })).toEqual({
      text: "Checking.",
      toolCalls: [{ id: "tool-1", name: "read_fixture", arguments: {} }],
      promptTokens: 12,
      completionTokens: 4
    });
  });
});
