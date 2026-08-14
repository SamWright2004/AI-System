import OpenAI from "openai";
import type { AssistantGateway, AssistantInput } from "../../core/chat/types.js";

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

  public async *streamReply(input: AssistantInput): AsyncIterable<string> {
    const stream = await this.client.responses.create(
      {
        model: this.model,
        instructions: this.instructions,
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
        yield event.delta;
      }
    }
  }
}
