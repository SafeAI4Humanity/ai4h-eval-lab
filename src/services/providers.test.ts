import { describe, expect, it } from "vitest";
import {
  assertKieCreditResponse,
  emptyProviderResponseMessage,
  kieModelIds,
  normalizeProviderBaseUrl,
  ollamaThinkingSetting,
  openAiCompatibleMaxTokens,
  openAiCompatibleThinkingSetting,
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

describe("ollamaThinkingSetting", () => {
  it("disables thinking so evaluation token limits produce a final answer", () => {
    expect(ollamaThinkingSetting("qwen3.6:custom")).toBe(false);
    expect(ollamaThinkingSetting("deepseek-r1:latest")).toBe(false);
  });

  it("uses the lowest supported reasoning level for GPT-OSS", () => {
    expect(ollamaThinkingSetting("gpt-oss:latest")).toBe("low");
  });
});

describe("openAiCompatibleThinkingSetting", () => {
  it("sends both backend variants so any compatible server can disable thinking", () => {
    const expected = { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "none" };
    expect(openAiCompatibleThinkingSetting("qwen3.8:latest")).toEqual(expected);
    expect(openAiCompatibleThinkingSetting("deepseek-r1:latest")).toEqual(expected);
    expect(openAiCompatibleThinkingSetting("gpt-oss:latest")).toEqual(expected);
  });

  it("sends no thinking setting for non-reasoning models", () => {
    expect(openAiCompatibleThinkingSetting("gpt-5-2")).toEqual({});
    expect(openAiCompatibleThinkingSetting("gemini-3-pro")).toEqual({});
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
    expect(openAiCompatibleMaxTokens("gpt-5-2", undefined)).toBe(500);
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
