import { NotFoundError } from "../../shared/errors.js";
import type {
  ActivityRepository,
  AssistantGateway,
  ChatStreamEvent,
  ConversationRepository,
  HomeState,
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

    try {
      for await (const delta of this.assistant.streamReply({
        messages: context,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        completeText += delta;
        yield { type: "delta", text: delta };
      }

      const assistantMessage = await this.conversations.addMessage({
        threadId: thread.id,
        role: "assistant",
        content: completeText,
        provider: this.assistant.provider,
        model: this.assistant.model,
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
