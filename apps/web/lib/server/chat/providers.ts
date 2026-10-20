/** OpenAI-compatible free tiers, tried in order with failover on rate limits / outages (§5.9). */
export interface ChatProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CompletionResult {
  provider: string;
  message: ChatMessage;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export type CompleteFn = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<CompletionResult>;

export class ChatProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderError";
  }
}

export function providersFromEnv(env: Record<string, string | undefined> = process.env): ChatProvider[] {
  const list: (ChatProvider | null)[] = [
    env.GROQ_API_KEY ? { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? "openai/gpt-oss-120b" } : null,
    env.CEREBRAS_API_KEY ? { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL ?? "gpt-oss-120b" } : null,
    env.OPENROUTER_API_KEY ? { name: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b:free" } : null,
  ];
  return list.filter((p): p is ChatProvider => p !== null);
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export function createProviderChain(providers: ChatProvider[], fetchImpl: typeof fetch = fetch): CompleteFn {
  return async (messages, tools) => {
    if (providers.length === 0) throw new ChatProviderError("no chat provider configured");
    let lastError = "no provider answered";
    for (const p of providers) {
      let res: Response;
      try {
        res = await fetchImpl(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: p.model, messages, tools, tool_choice: "auto", temperature: 0.2 }),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        lastError = `${p.name}: network error`;
        continue;
      }
      if (!res.ok) {
        lastError = `${p.name}: HTTP ${res.status}`;
        if (RETRYABLE(res.status)) continue;
        throw new ChatProviderError(lastError);
      }
      const body = (await res.json()) as { choices?: { message?: ChatMessage }[]; usage?: CompletionResult["usage"] };
      const message = body.choices?.[0]?.message;
      if (!message) {
        lastError = `${p.name}: empty response`;
        continue;
      }
      return { provider: p.name, message, usage: body.usage };
    }
    throw new ChatProviderError(lastError);
  };
}
