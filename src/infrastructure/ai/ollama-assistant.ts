import type {
  AssistantGateway,
  AssistantInput,
  AssistantStreamChunk,
  AssistantUsage,
} from "../../core/chat/types.js";

interface OllamaChunk {
  message?: {
    content?: string;
  };
  error?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

function nanosecondsToMilliseconds(value?: number): number | undefined {
  return value === undefined ? undefined : value / 1_000_000;
}

function usageFromChunk(chunk: OllamaChunk): AssistantUsage {
  const usage: AssistantUsage = {};

  if (chunk.prompt_eval_count !== undefined) {
    usage.inputTokens = chunk.prompt_eval_count;
  }

  if (chunk.eval_count !== undefined) {
    usage.outputTokens = chunk.eval_count;
  }

  const providerTotalMs = nanosecondsToMilliseconds(chunk.total_duration);

  if (providerTotalMs !== undefined) {
    usage.providerTotalMs = providerTotalMs;
  }

  const providerLoadMs = nanosecondsToMilliseconds(chunk.load_duration);

  if (providerLoadMs !== undefined) {
    usage.providerLoadMs = providerLoadMs;
  }

  const providerPromptEvalMs = nanosecondsToMilliseconds(chunk.prompt_eval_duration);

  if (providerPromptEvalMs !== undefined) {
    usage.providerPromptEvalMs = providerPromptEvalMs;
  }

  const providerGenerationMs = nanosecondsToMilliseconds(chunk.eval_duration);

  if (providerGenerationMs !== undefined) {
    usage.providerGenerationMs = providerGenerationMs;
  }

  return usage;
}

export class OllamaAssistantGateway implements AssistantGateway {
  public readonly provider = "ollama";

  public constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly instructions: string,
    private readonly think: boolean,
  ) {}

  public async *streamReply(input: AssistantInput): AsyncIterable<AssistantStreamChunk> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },

      signal: input.signal ?? null,
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: this.instructions,
          },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        stream: true,
        think: this.think,
      }),
    });

    if (!response.ok) {
      const body = await response.text();

      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("Ollama returned no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      buffer += decoder.decode(value, { stream: !done });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
          continue;
        }

        const chunk = JSON.parse(line) as OllamaChunk;

        if (chunk.error) {
          throw new Error(`Ollama error: ${chunk.error}`);
        }

        if (chunk.message?.content) {
          yield {
            type: "delta",
            text: chunk.message.content,
          };
        }

        if (chunk.done) {
          yield {
            type: "usage",
            usage: usageFromChunk(chunk),
          };
        }
      }

      if (done) {
        break;
      }
    }

    const finalLine = buffer.trim();

    if (finalLine) {
      const chunk = JSON.parse(finalLine) as OllamaChunk;

      if (chunk.error) {
        throw new Error(`Ollama error: ${chunk.error}`);
      }

      if (chunk.message?.content) {
        yield {
          type: "delta",
          text: chunk.message.content,
        };
      }

      if (chunk.done) {
        yield {
          type: "usage",
          usage: usageFromChunk(chunk),
        };
      }
    }
  }
}
