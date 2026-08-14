import type { AssistantGateway, AssistantInput } from "../../core/chat/types.js";

interface OllamaChunk {
  message?: {
    content?: string;
  };
  error?: string;
  done?: boolean;
}

export class OllamaAssistantGateway implements AssistantGateway {
  public readonly provider = "ollama";

  public constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly instructions: string,
    private readonly think: boolean,
  ) {}

  public async *streamReply(input: AssistantInput): AsyncIterable<string> {
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
          yield chunk.message.content;
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
        yield chunk.message.content;
      }
    }
  }
}
