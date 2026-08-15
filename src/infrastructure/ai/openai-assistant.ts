import OpenAI from "openai";
import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import type { AssistantGateway, AssistantInput } from "../../core/chat/types.js";
import { composeInstructions } from "./compose-instructions.js";

export class OpenAiAssistantGateway implements AssistantGateway {
  public readonly provider = "openai";

  public constructor(
    apiKey: string,
    public readonly model: string,
    private readonly instructions: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  private readonly client: OpenAI;

  public async *streamReply(input: AssistantInput): AsyncIterable<{ type: "delta"; text: string }> {
    try {
      const stream = await this.client.responses.create(
        {
          model: this.model,
          instructions: composeInstructions(this.instructions, input.context),
          input: input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          store: false,
          stream: true,
        },
        input.signal ? { signal: input.signal } : undefined,
      );

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield {
            type: "delta",
            text: event.delta,
          };
        }
      }
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error;

      const candidateStatus =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: unknown }).status
          : undefined;
      const status = typeof candidateStatus === "number" ? candidateStatus : undefined;

      if (status === 401 || status === 403) {
        throw new ProviderError(
          "PROVIDER_AUTHENTICATION_FAILED",
          "OpenAI rejected the configured API key. Check the local provider settings.",
          false,
          { cause: error },
        );
      }
      if (status === 429) {
        throw new ProviderError(
          "PROVIDER_RATE_LIMITED",
          "OpenAI is rate-limited. Wait a moment, then retry.",
          true,
          { cause: error },
        );
      }
      throw new ProviderError(
        status !== undefined && status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        status !== undefined
          ? `OpenAI request failed with status ${status}.`
          : "I couldn’t reach OpenAI. Check the connection, then retry.",
        status === undefined || status >= 500,
        { cause: error },
      );
    }
  }
}
