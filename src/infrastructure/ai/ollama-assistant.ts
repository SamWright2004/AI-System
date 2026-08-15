import type {
  AssistantGateway,
  AssistantInput,
  AssistantStreamChunk,
  AssistantUsage,
} from "../../core/chat/types.js";
import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import { composeInstructions } from "./compose-instructions.js";

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

function parseChunk(line: string): OllamaChunk {
  try {
    return JSON.parse(line) as OllamaChunk;
  } catch (error) {
    throw new ProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Ollama returned a malformed streaming response. Restart Ollama, then try again.",
      true,
      { cause: error },
    );
  }
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
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
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
              content: composeInstructions(this.instructions, input.context),
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
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error;
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "I couldn’t reach Ollama. Check that Ollama is running, then retry.",
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300);
      const suffix = detail ? ` ${detail}` : "";
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          "PROVIDER_AUTHENTICATION_FAILED",
          `Ollama rejected the request.${suffix}`,
          false,
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          "PROVIDER_RATE_LIMITED",
          "Ollama is busy or rate-limited. Wait a moment, then retry.",
          true,
        );
      }
      throw new ProviderError(
        response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        `Ollama request failed with status ${response.status}.${suffix}`,
        response.status >= 500,
      );
    }

    if (!response.body) {
      throw new ProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Ollama returned no response body. You can retry this message.",
        true,
      );
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

        const chunk = parseChunk(line);

        if (chunk.error) {
          throw new ProviderError(
            "PROVIDER_REQUEST_FAILED",
            `Ollama reported an error: ${chunk.error}`,
            true,
          );
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
      const chunk = parseChunk(finalLine);

      if (chunk.error) {
        throw new ProviderError(
          "PROVIDER_REQUEST_FAILED",
          `Ollama reported an error: ${chunk.error}`,
          true,
        );
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
