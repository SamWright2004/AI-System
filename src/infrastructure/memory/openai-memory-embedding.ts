import OpenAI from "openai";
import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import type { MemoryEmbeddingBatch, MemoryEmbeddingGateway } from "../../core/memory/types.js";

export class OpenAiMemoryEmbeddingGateway implements MemoryEmbeddingGateway {
  public readonly provider = "openai";
  private readonly client: OpenAI;

  public constructor(
    apiKey: string,
    public readonly model: string,
    private readonly dimensions?: number,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  public async embed(
    input: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Promise<MemoryEmbeddingBatch> {
    try {
      const response = await this.client.embeddings.create(
        {
          model: this.model,
          input: [...input],
          encoding_format: "float",
          ...(this.dimensions !== undefined ? { dimensions: this.dimensions } : {}),
        },
        signal ? { signal } : undefined,
      );
      const vectors = [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
      const first = vectors[0];
      if (!first || vectors.length !== input.length || first.length === 0) {
        throw new ProviderError(
          "PROVIDER_RESPONSE_INVALID",
          "OpenAI returned an invalid embedding batch. Lexical memory still works.",
          true,
        );
      }
      return {
        provider: this.provider,
        // Keep the configured identifier stable so aliases do not create a
        // second index when a provider reports a resolved model name.
        model: this.model,
        dimensions: first.length,
        vectors,
      };
    } catch (error) {
      if (error instanceof ProviderError || isAbortError(error, signal)) throw error;
      throw new ProviderError(
        "PROVIDER_REQUEST_FAILED",
        "OpenAI could not create memory embeddings. Lexical memory still works.",
        true,
        { cause: error },
      );
    }
  }
}
