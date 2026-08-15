import { describe, expect, it } from "vitest";
import { ChatService } from "../src/core/chat/chat-service.js";
import { ContextAssembler } from "../src/core/context/context-assembler.js";
import type {
  ActivityItem,
  ActivityRepository,
  AssistantGateway,
  AssistantInput,
  ConversationRepository,
  Message,
  MessagePageCursor,
  Thread,
} from "../src/core/chat/types.js";

const now = "2026-08-12T20:00:00.000Z";

class MemoryStore implements ConversationRepository, ActivityRepository {
  public readonly thread: Thread = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Home",
    kind: "primary",
    createdAt: now,
    updatedAt: now,
  };

  public readonly messages: Message[] = [];
  public readonly activity: ActivityItem[] = [];

  public async ensurePrimaryThread() {
    return this.thread;
  }

  public async findThread(id: string) {
    return id === this.thread.id ? this.thread : null;
  }

  public async listMessages(_threadId: string, limit = 100) {
    return this.messages.slice(-limit);
  }

  public async listMessagePage(input: {
    threadId: string;
    limit: number;
    before?: MessagePageCursor;
  }) {
    const newestFirst = [...this.messages].reverse();
    const start = input.before
      ? Math.max(
          0,
          newestFirst.findIndex((message) => message.id === input.before?.id) + 1,
        )
      : 0;
    const messages = newestFirst.slice(start, start + input.limit);
    const hasMore = newestFirst.length > start + input.limit;
    const oldest = messages.at(-1);

    return {
      messages,
      nextCursor:
        hasMore && oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null,
    };
  }

  public async addMessage(input: {
    threadId: string;
    role: Message["role"];
    content: string;
    status?: Message["status"];
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  }) {
    const message: Message = {
      id: `22222222-2222-4222-8222-${String(this.messages.length).padStart(12, "0")}`,
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      status: input.status ?? "complete",
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
    };
    this.messages.push(message);
    return message;
  }

  public async listRecent(limit = 12) {
    return this.activity.slice(-limit);
  }

  public async markRead(_id: string) {}
}

class FixedAssistant implements AssistantGateway {
  public readonly provider = "test";
  public readonly model = "fixed";

  public async *streamReply(_input: AssistantInput) {
    yield {
      type: "delta" as const,
      text: "Hello ",
    };

    yield {
      type: "delta" as const,
      text: "there.",
    };

    yield {
      type: "usage" as const,
      usage: {
        inputTokens: 12,
        outputTokens: 4,
      },
    };
  }
}

describe("ChatService", () => {
  it("persists both sides of a streamed exchange", async () => {
    const store = new MemoryStore();
    const context = new ContextAssembler(store, {
      inputTokenBudget: 1_000,
      historyPageSize: 10,
    });
    const service = new ChatService(store, store, new FixedAssistant(), context);
    const events = [];

    for await (const event of service.reply({ content: "Are you awake?" })) {
      events.push(event);
    }

    expect(store.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Are you awake?"],
      ["assistant", "Hello there."],
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "thread",
      "user_message",
      "delta",
      "delta",
      "assistant_message",
      "done",
    ]);
    expect(store.messages.at(-1)?.metadata.context).toMatchObject({
      version: 1,
      budgetTokens: 1_000,
      history: { messagesSelected: 1 },
    });
  });
});
