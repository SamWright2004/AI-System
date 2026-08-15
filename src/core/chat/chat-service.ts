import { NotFoundError } from "../../shared/errors.js";
import type {
  ActivityRepository,
  AssistantGateway,
  ChatStreamEvent,
  ConversationRepository,
  HomeState,
  AssistantUsage,
} from "./types.js";

export class ChatService {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly activity: ActivityRepository,
    private readonly assistant: AssistantGateway,
  ) {}

  public async getHomeState(): Promise<HomeState> {
    const thread = await this.conversations.ensurePrimaryThread();
    const [messages, activity] = await Promise.all([
      this.conversations.listMessages(thread.id, 100),
      this.activity.listRecent(12),
    ]);

    return { thread, messages, activity };
  }

  public async *reply(input: {
    threadId?: string;
    content: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent> {
    const thread = input.threadId
      ? await this.conversations.findThread(input.threadId)
      : await this.conversations.ensurePrimaryThread();

    if (!thread) {
      throw new NotFoundError("That conversation no longer exists.");
    }

    yield { type: "thread", thread };

    const userMessage = await this.conversations.addMessage({
      threadId: thread.id,
      role: "user",
      content: input.content,
    });
    yield { type: "user_message", message: userMessage };

    const context = await this.conversations.listMessages(thread.id, 60);
    let completeText = "";
    let usage: AssistantUsage | undefined;

    const startedAt = performance.now();
    let firstTokenMs: number | null = null;

    try {
      for await (const chunk of this.assistant.streamReply({
        messages: context,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        if (chunk.type === "usage") {
          usage = chunk.usage;
          continue;
        }

        if (firstTokenMs === null) {
          firstTokenMs = Math.round(performance.now() - startedAt);
        }

        completeText += chunk.text;
        yield { type: "delta", text: chunk.text };
      }

      const wallMs = Math.round(performance.now() - startedAt);

      const assistantMessage = await this.conversations.addMessage({
        threadId: thread.id,
        role: "assistant",
        content: completeText,
        provider: this.assistant.provider,
        model: this.assistant.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        metadata: {
          timing: {
            wallMs,
            firstTokenMs,
            providerTotalMs: usage?.providerTotalMs,
            providerLoadMs: usage?.providerLoadMs,
            providerPromptEvalMs: usage?.providerPromptEvalMs,
            providerGenerationMs: usage?.providerGenerationMs,
          },
        },
      });

      yield { type: "assistant_message", message: assistantMessage };
      yield { type: "done" };
    } catch (error) {
      if (completeText.trim()) {
        await this.conversations.addMessage({
          threadId: thread.id,
          role: "assistant",
          content: completeText,
          status: "failed",
          provider: this.assistant.provider,
          model: this.assistant.model,
        });
      }

      const message = error instanceof Error ? error.message : "The response stopped unexpectedly.";
      yield { type: "error", message };
    }
  }
}
