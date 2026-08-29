import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import type { MemoryEmbeddingBatch, MemoryEmbeddingGateway } from "../../core/memory/types.js";

interface OllamaEmbeddingResponse {
  model?: string;
  embeddings?: number[][];
  error?: string;
}

export class OllamaMemoryEmbeddingGateway implements MemoryEmbeddingGateway {
  public readonly provider = "ollama";

  public constructor(
    private readonly baseUrl: string,
    public readonly model: string,
  ) {}

  public async embed(
    input: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Promise<MemoryEmbeddingBatch> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl.replace(/\/$/, "") + "/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal ?? null,
        body: JSON.stringify({ model: this.model, input, truncate: true }),
      });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "I couldn’t reach Ollama for memory retrieval. Lexical memory still works.",
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 240);
      throw new ProviderError(
        response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        `Ollama embeddings failed with status ${response.status}${detail ? `: ${detail}` : "."}`,
        response.status >= 500,
      );
    }

    const body = (await response.json()) as OllamaEmbeddingResponse;
    if (body.error) {
      throw new ProviderError("PROVIDER_REQUEST_FAILED", "Ollama reported: " + body.error, true);
    }
    const vectors = body.embeddings;
    const first = vectors?.[0];
    if (!vectors || !first || vectors.length !== input.length || first.length === 0) {
      throw new ProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Ollama returned an invalid embedding batch. Lexical memory still works.",
        true,
      );
    }

    return {
      provider: this.provider,
      // Ollama may report a resolved tag; index coverage is keyed to the
      // configured identifier so model aliases remain stable.
      model: this.model,
      dimensions: first.length,
      vectors,
    };
  }
}
