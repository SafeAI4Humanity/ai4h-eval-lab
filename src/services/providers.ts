import type { ChatMessage, Connection, ProviderResponse } from "../types";
import { appFetch, normalizeBaseUrl, readJson } from "./http";
import { getSecret } from "./storage";
import { diagnosticLog, redactDiagnosticUrl } from "./diagnostics";

type RequestOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  signal?: AbortSignal;
};

type JsonRecord = Record<string, any>;

type KieModel = {
  id: string;
  endpoint: string;
  protocol: "openai-chat" | "anthropic";
};

export const KIE_MODELS: readonly KieModel[] = [
  { id: "gpt-5-2", endpoint: "/gpt-5-2/v1/chat/completions", protocol: "openai-chat" },
  { id: "gemini-3-pro", endpoint: "/gemini-3-pro/v1/chat/completions", protocol: "openai-chat" },
  { id: "claude-opus-4-7", endpoint: "/claude/v1/messages", protocol: "anthropic" }
];

export function kieModelIds(): string[] {
  return KIE_MODELS.map((model) => model.id);
}

export function assertKieCreditResponse(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const response = data as JsonRecord;
  if (response.code !== undefined && Number(response.code) !== 200) {
    throw new Error(typeof response.msg === "string" ? response.msg : "Kie.ai rejected the API key.");
  }
}

export function parseOpenAIModels(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const models = (data as JsonRecord).data;
  if (!Array.isArray(models)) return [];
  return models
    .map((model: unknown) => model && typeof model === "object" ? (model as JsonRecord).id : "")
    .filter((model: unknown): model is string => typeof model === "string" && Boolean(model));
}

function isZeroPrice(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const price = Number(value);
  return Number.isFinite(price) && price === 0;
}

export function parseOpenRouterModels(data: unknown, freeOnly = false): string[] {
  if (!data || typeof data !== "object") return [];
  const models = (data as JsonRecord).data;
  if (!Array.isArray(models)) return [];
  return models
    .filter((model: unknown) => {
      if (!model || typeof model !== "object") return false;
      if (!freeOnly) return true;
      const pricing = (model as JsonRecord).pricing;
      if (!pricing || typeof pricing !== "object") return false;
      return isZeroPrice(pricing.prompt)
        && isZeroPrice(pricing.completion)
        && (pricing.request === undefined || isZeroPrice(pricing.request));
    })
    .map((model: unknown) => model && typeof model === "object" ? (model as JsonRecord).id : "")
    .filter((model: unknown): model is string => typeof model === "string" && Boolean(model));
}

export function parseOllamaModels(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const models = (data as JsonRecord).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((model: unknown) => {
      if (!model || typeof model !== "object") return "";
      const record = model as JsonRecord;
      return typeof record.name === "string" ? record.name : typeof record.model === "string" ? record.model : "";
    })
    .filter((model: string) => Boolean(model));
}

const providerDefaults = {
  ollama: "http://localhost:11434",
  openrouter: "https://openrouter.ai/api",
  kie: "https://api.kie.ai",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  "openai-compatible": "http://localhost:1234"
} as const;

export function defaultBaseUrl(provider: Connection["provider"]): string {
  return providerDefaults[provider];
}

export function normalizeProviderBaseUrl(provider: Connection["provider"], value: string): string {
  const normalized = normalizeBaseUrl(value);
  if (provider === "ollama") return normalized.replace(/\/(?:v1|api)$/i, "");
  return normalized;
}

export function ollamaThinkingSetting(model: string): false | "low" {
  return model.toLocaleLowerCase().includes("gpt-oss") ? "low" : false;
}

async function request(
  connection: Connection,
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
  secretOverride?: string
): Promise<unknown> {
  const secret = secretOverride ?? await getSecret(connection.id);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  if (connection.provider === "anthropic") {
    if (secret) headers.set("x-api-key", secret);
    headers.set("anthropic-version", "2023-06-01");
  } else if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
  }

  if (connection.provider === "openrouter") {
    headers.set("HTTP-Referer", "https://ai-4-h.org/");
    headers.set("X-OpenRouter-Title", "AI4H Eval Lab");
  }

  const controller = timeoutMs ? new AbortController() : null;
  let timedOut = false;
  const onAbort = () => controller?.abort();
  if (controller && init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = controller ? window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : undefined;

  try {
    const response = await appFetch(`${normalizeProviderBaseUrl(connection.provider, connection.baseUrl)}${path}`, {
      ...init,
      headers,
      signal: controller?.signal ?? init.signal
    });
    return readJson(response);
  } catch (error) {
    if (timedOut) throw new Error(`Connection timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`);
    if (connection.provider === "ollama") {
      const endpoint = redactDiagnosticUrl(normalizeProviderBaseUrl(connection.provider, connection.baseUrl));
      const details = error instanceof Error ? error.message : String(error);
      const localNetworkHint = /\.local(?::|\/|$)/i.test(endpoint)
        ? " On macOS, allow AI4H Eval Lab in System Settings → Privacy & Security → Local Network, then retry."
        : "";
      throw new Error(`Could not reach the Ollama server at ${endpoint}.${localNetworkHint} Details: ${details}`);
    }
    throw error;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

export async function discoverModels(connection: Connection, secretOverride?: string): Promise<string[]> {
  if (connection.provider === "ollama") {
    const data = (await request(connection, "/api/tags", {}, 10_000, secretOverride)) as JsonRecord;
    return parseOllamaModels(data);
  }

  if (connection.provider === "kie") {
    const credit = await request(connection, "/api/v1/chat/credit", {}, 10_000, secretOverride);
    assertKieCreditResponse(credit);
    return kieModelIds();
  }

  if (connection.provider === "openrouter") {
    await request(connection, "/v1/key", {}, 10_000, secretOverride);
    const data = await request(connection, "/v1/models", {}, 10_000, secretOverride);
    return parseOpenRouterModels(data, connection.openRouterFreeOnly ?? false);
  }

  if (connection.provider === "anthropic") {
    const data = await request(connection, "/v1/models", {}, 10_000, secretOverride);
    return parseOpenAIModels(data);
  }

  if (connection.provider === "gemini") {
    const secret = secretOverride ?? await getSecret(connection.id);
    const suffix = secret ? `?key=${encodeURIComponent(secret)}` : "";
    const response = await appFetch(`${normalizeBaseUrl(connection.baseUrl)}/v1beta/models${suffix}`);
    const data = (await readJson(response)) as JsonRecord;
    return (data.models ?? [])
      .filter((model: JsonRecord) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((model: JsonRecord) => String(model.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }

  const data = await request(connection, "/v1/models", {}, 10_000, secretOverride);
  return parseOpenAIModels(data);
}

export async function testConnection(connection: Connection, secretOverride?: string): Promise<string[]> {
  diagnosticLog("info", "connection.test.started", {
    connectionId: connection.id,
    provider: connection.provider,
    baseUrl: redactDiagnosticUrl(normalizeProviderBaseUrl(connection.provider, connection.baseUrl))
  });
  try {
    const models = await discoverModels(connection, secretOverride);
    if (!models.length && connection.provider !== "anthropic") {
      throw new Error("Connection succeeded, but no compatible models were returned.");
    }
    diagnosticLog("info", "connection.test.succeeded", {
      connectionId: connection.id,
      provider: connection.provider,
      modelCount: models.length
    });
    return models;
  } catch (error) {
    diagnosticLog("error", "connection.test.failed", {
      connectionId: connection.id,
      provider: connection.provider,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function generateResponse(connection: Connection, options: RequestOptions): Promise<ProviderResponse> {
  if (connection.provider === "ollama") {
    const data = (await request(connection, "/api/chat", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        think: ollamaThinkingSetting(options.model),
        stream: false,
        options: {
          temperature: options.temperature ?? 0,
          num_predict: options.maxTokens ?? 500,
          ...(options.seed === undefined ? {} : { seed: options.seed })
        }
      })
    })) as JsonRecord;
    const text = typeof data.message?.content === "string" ? data.message.content : "";
    const thinking = typeof data.message?.thinking === "string" ? data.message.thinking : "";
    diagnosticLog("info", "ollama.response", {
      model: options.model,
      contentCharacters: text.length,
      thinkingCharacters: thinking.length,
      doneReason: typeof data.done_reason === "string" ? data.done_reason : null,
      generatedTokens: typeof data.eval_count === "number" ? data.eval_count : null
    });
    if (!text.trim()) {
      if (thinking) {
        throw new Error(`Ollama returned ${thinking.length} characters of reasoning but no final answer (finish reason: ${data.done_reason ?? "unknown"}). The response was not scored.`);
      }
      throw new Error(`Ollama returned an empty final answer (finish reason: ${data.done_reason ?? "unknown"}). The response was not scored.`);
    }
    return {
      text,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count
    };
  }

  if (connection.provider === "anthropic") {
    const system = options.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages = options.messages.filter((message) => message.role !== "system");
    const data = (await request(connection, "/v1/messages", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        system: system || undefined,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 500
      })
    })) as JsonRecord;
    return {
      text: (data.content ?? []).filter((part: JsonRecord) => part.type === "text").map((part: JsonRecord) => part.text).join("\n"),
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens
    };
  }

  if (connection.provider === "gemini") {
    const secret = await getSecret(connection.id);
    const system = options.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = options.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
    const response = await appFetch(
      `${normalizeBaseUrl(connection.baseUrl)}/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(secret)}`,
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: {
            temperature: options.temperature ?? 0,
            maxOutputTokens: options.maxTokens ?? 500
          }
        })
      }
    );
    const data = (await readJson(response)) as JsonRecord;
    return {
      text: data.candidates?.[0]?.content?.parts?.map((part: JsonRecord) => part.text ?? "").join("") ?? "",
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount
    };
  }

  if (connection.provider === "kie") {
    const selected = KIE_MODELS.find((model) => model.id === options.model);
    if (!selected) {
      throw new Error(`Unsupported Kie.ai model ID: ${options.model}. Refresh the connection and choose a supported model.`);
    }

    if (selected.protocol === "anthropic") {
      const system = options.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
      const messages = options.messages.filter((message) => message.role !== "system");
      const data = (await request(connection, selected.endpoint, {
        method: "POST",
        signal: options.signal,
        body: JSON.stringify({
          model: selected.id,
          system: system || undefined,
          messages,
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens ?? 500,
          stream: false
        })
      })) as JsonRecord;
      return {
        text: (data.content ?? []).filter((part: JsonRecord) => part.type === "text").map((part: JsonRecord) => part.text).join("\n"),
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens
      };
    }

    const data = (await request(connection, selected.endpoint, {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        messages: options.messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 500,
        stream: false
      })
    })) as JsonRecord;
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens
    };
  }

  const data = (await request(connection, "/v1/chat/completions", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 500,
      stream: false,
      ...(options.seed === undefined ? {} : { seed: options.seed })
    })
  })) as JsonRecord;

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens
  };
}

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentConversationMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentProviderToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AgentProviderToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentProviderTurn = ProviderResponse & { toolCalls: AgentProviderToolCall[] };

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => part && typeof part === "object" && typeof (part as JsonRecord).text === "string" ? (part as JsonRecord).text : "").join("");
}

function toolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The model returned invalid tool-call arguments.");
  return parsed as Record<string, unknown>;
}

function openAiMessages(messages: AgentConversationMessage[]): JsonRecord[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content };
    if (message.role === "assistant" && message.toolCalls?.length) return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    };
    return { role: message.role, content: message.content };
  });
}

export function parseOpenAiAgentTurn(data: JsonRecord): AgentProviderTurn {
  const message = data.choices?.[0]?.message ?? data.message ?? {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    text: textContent(message.content),
    toolCalls: calls.map((call: JsonRecord) => ({
      id: typeof call.id === "string" ? call.id : crypto.randomUUID(),
      name: String(call.function?.name ?? ""),
      arguments: toolArguments(call.function?.arguments)
    })).filter((call: AgentProviderToolCall) => Boolean(call.name)),
    promptTokens: data.usage?.prompt_tokens ?? data.prompt_eval_count,
    completionTokens: data.usage?.completion_tokens ?? data.eval_count
  };
}

function anthropicMessages(messages: AgentConversationMessage[]): JsonRecord[] {
  return messages.filter((message) => message.role !== "system").map((message) => {
    if (message.role === "tool") return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }]
    };
    if (message.role === "assistant" && message.toolCalls?.length) return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }))
      ]
    };
    return { role: message.role, content: message.content };
  });
}

export function parseAnthropicAgentTurn(data: JsonRecord): AgentProviderTurn {
  const parts = Array.isArray(data.content) ? data.content : [];
  return {
    text: parts.filter((part: JsonRecord) => part.type === "text").map((part: JsonRecord) => String(part.text ?? "")).join("\n"),
    toolCalls: parts.filter((part: JsonRecord) => part.type === "tool_use").map((part: JsonRecord) => ({
      id: String(part.id ?? crypto.randomUUID()),
      name: String(part.name ?? ""),
      arguments: toolArguments(part.input)
    })),
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens
  };
}

function geminiContents(messages: AgentConversationMessage[]): JsonRecord[] {
  return messages.filter((message) => message.role !== "system").map((message) => {
    if (message.role === "tool") return {
      role: "user",
      parts: [{ functionResponse: { name: message.name, response: { content: message.content } } }]
    };
    if (message.role === "assistant") return {
      role: "model",
      parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ functionCall: { name: call.name, args: call.arguments, id: call.id } }))
      ]
    };
    return { role: "user", parts: [{ text: message.content }] };
  });
}

/** Runs one model turn with declarative tools. Tool execution remains in the local runner. */
export async function generateAgentTurn(
  connection: Connection,
  options: {
    model: string;
    messages: AgentConversationMessage[];
    tools: AgentToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }
): Promise<AgentProviderTurn> {
  const system = options.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");

  if (connection.provider === "ollama") {
    const messages = options.messages.map((message) => {
      if (message.role === "tool") return { role: "tool", tool_name: message.name, content: message.content };
      if (message.role === "assistant" && message.toolCalls?.length) return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } }))
      };
      return { role: message.role, content: message.content };
    });
    const data = await request(connection, "/api/chat", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
        think: ollamaThinkingSetting(options.model),
        stream: false,
        options: { temperature: options.temperature ?? 0, num_predict: options.maxTokens ?? 800 }
      })
    }) as JsonRecord;
    return parseOpenAiAgentTurn(data);
  }

  if (connection.provider === "anthropic" || (connection.provider === "kie" && KIE_MODELS.find((model) => model.id === options.model)?.protocol === "anthropic")) {
    const path = connection.provider === "kie"
      ? KIE_MODELS.find((model) => model.id === options.model)!.endpoint
      : "/v1/messages";
    const data = await request(connection, path, {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        system: system || undefined,
        messages: anthropicMessages(options.messages),
        tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 800,
        stream: false
      })
    }) as JsonRecord;
    return parseAnthropicAgentTurn(data);
  }

  if (connection.provider === "gemini") {
    const secret = await getSecret(connection.id);
    const response = await appFetch(
      `${normalizeBaseUrl(connection.baseUrl)}/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(secret)}`,
      {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: geminiContents(options.messages),
          tools: [{ functionDeclarations: options.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }],
          generationConfig: { temperature: options.temperature ?? 0, maxOutputTokens: options.maxTokens ?? 800 }
        })
      }
    );
    const data = await readJson(response) as JsonRecord;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.filter((part: JsonRecord) => typeof part.text === "string").map((part: JsonRecord) => part.text).join(""),
      toolCalls: parts.filter((part: JsonRecord) => part.functionCall).map((part: JsonRecord) => ({
        id: String(part.functionCall.id ?? crypto.randomUUID()),
        name: String(part.functionCall.name ?? ""),
        arguments: toolArguments(part.functionCall.args)
      })),
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount
    };
  }

  const selectedKie = connection.provider === "kie" ? KIE_MODELS.find((model) => model.id === options.model) : undefined;
  if (connection.provider === "kie" && !selectedKie) throw new Error(`Unsupported Kie.ai model ID: ${options.model}.`);
  const data = await request(connection, selectedKie?.endpoint ?? "/v1/chat/completions", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: openAiMessages(options.messages),
      tools: options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
      tool_choice: "auto",
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 800,
      stream: false
    })
  }) as JsonRecord;
  return parseOpenAiAgentTurn(data);
}

export function providerLabel(provider: Connection["provider"]): string {
  return {
    ollama: "Ollama",
    openrouter: "OpenRouter",
    kie: "Kie.ai",
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini",
    "openai-compatible": "OpenAI-compatible"
  }[provider];
}
