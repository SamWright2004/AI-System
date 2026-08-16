import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import type {
  MemoryExtractionGateway,
  MemoryExtractionInput,
} from "../../core/memory/types.js";
import {
  memoryExtractionJsonSchema,
  parseMemoryExtractionJson,
} from "./memory-extraction-schema.js";

interface OllamaMemoryResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export class OllamaMemoryExtractor implements MemoryExtractionGateway {
  public readonly provider = "ollama";

  public constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly instructions: string,
  ) {}

  public async extract(input: MemoryExtractionInput) {
    let response: Response;
    try {
      response = await fetch(this.baseUrl.replace(/\/$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.signal ?? null,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: this.instructions },
            {
              role: "user",
              content: JSON.stringify({
                thread: input.thread,
                ownerMessages: input.messages,
              }),
            },
          ],
          stream: false,
          think: false,
          format: memoryExtractionJsonSchema,
          options: { temperature: 0 },
        }),
      });
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error;
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "I couldn’t reach Ollama to review this conversation for memories.",
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ProviderError(
        response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        "Ollama memory extraction failed with status " + response.status + ".",
        response.status >= 500,
      );
    }

    const body = (await response.json()) as OllamaMemoryResponse;
    if (body.error) {
      throw new ProviderError(
        "PROVIDER_REQUEST_FAILED",
        "Ollama reported: " + body.error,
        true,
      );
    }

    const content = body.message?.content;
    if (!content) {
      throw new ProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Ollama returned no structured memory proposals.",
        true,
      );
    }

    let parsed;
    try {
      parsed = parseMemoryExtractionJson(content);
    } catch (error) {
      throw new ProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Ollama returned malformed memory proposals.",
        true,
        { cause: error },
      );
    }

    return {
      provider: this.provider,
      model: this.model,
      proposals: parsed.proposals,
    };
  }
}
