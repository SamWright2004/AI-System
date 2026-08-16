import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ProviderError } from "../../core/chat/generation-errors.js";
import type {
  MemoryExtractionGateway,
  MemoryExtractionInput,
} from "../../core/memory/types.js";
import { memoryExtractionSchema } from "./memory-extraction-schema.js";

export class OpenAiMemoryExtractor implements MemoryExtractionGateway {
  public readonly provider = "openai";
  private readonly client: OpenAI;

  public constructor(
    apiKey: string,
    public readonly model: string,
    private readonly instructions: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  public async extract(input: MemoryExtractionInput) {
    try {
      const response = await this.client.responses.parse(
        {
          model: this.model,
          input: [
            { role: "system", content: this.instructions },
            {
              role: "user",
              content: JSON.stringify({
                thread: input.thread,
                ownerMessages: input.messages,
              }),
            },
          ],
          text: {
            format: zodTextFormat(memoryExtractionSchema, "memory_proposals"),
          },
          max_output_tokens: 4_000,
          store: false,
        },
        input.signal ? { signal: input.signal } : undefined,
      );

      const parsed = memoryExtractionSchema.safeParse(response.output_parsed);
      if (!parsed.success) {
        throw new ProviderError(
          "PROVIDER_RESPONSE_INVALID",
          "OpenAI returned an invalid memory proposal set.",
          true,
          { cause: parsed.error },
        );
      }

      return {
        provider: this.provider,
        model: this.model,
        proposals: parsed.data.proposals,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "PROVIDER_REQUEST_FAILED",
        "OpenAI could not review this conversation for memory proposals.",
        true,
        { cause: error },
      );
    }
  }
}
