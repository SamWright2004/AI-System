import { describe, expect, it } from "vitest";
import { ChatService, deriveThreadTitle } from "../src/core/chat/chat-service.js";
import { ProviderError } from "../src/core/chat/generation-errors.js";
import { ContextAssembler } from "../src/core/context/context-assembler.js";
import { defaultPersonalisationProfile } from "../src/core/settings/types.js";
import type {
  ActivityItem,
  ActivityRepository,
  AssistantGateway,
  AssistantInput,
  ConversationRepository,
  Message,
  MessagePageCursor,
  Thread,
  ThreadSummary,
} from "../src/core/chat/types.js";
import type { PersonalisationStore } from "../src/core/settings/types.js";

const now = "2026-08-12T20:00:00.000Z";

class MemoryStore implements ConversationRepository, ActivityRepository {
  public readonly threads: Thread[] = [];
  public readonly messages: Message[] = [];
  public readonly activity: ActivityItem[] = [];

  public async createThread(input: { title: string; kind?: Thread["kind"] }) {
    const thread: Thread = {
      id: `11111111-1111-4111-8111-${String(this.threads.length).padStart(12, "0")}`,
      title: input.title,
      kind: input.kind ?? "temporary",
      createdAt: now,
      updatedAt: now,
    };
    this.threads.push(thread);
    return thread;
  }

  public async findThread(id: string) {
    return this.threads.find((thread) => thread.id === id) ?? null;
  }

  public async listThreads(limit = 80): Promise<ThreadSummary[]> {
    return this.threads.slice(-limit).map((thread) => {
      const messages = this.messages.filter((message) => message.threadId === thread.id);
      return {
        ...thread,
        messageCount: messages.length,
        lastMessagePreview: messages.at(-1)?.content ?? null,
      };
    });
  }

  public async updateThreadTitle(threadId: string, title: string) {
    const thread = await this.findThread(threadId);
    if (thread) thread.title = title;
    return thread;
  }

  public async archiveThread(threadId: string) {
    const index = this.threads.findIndex((thread) => thread.id === threadId);
    if (index < 0) return false;
    this.threads.splice(index, 1);
    return true;
  }

  public async listMessages(threadId: string, limit = 100) {
    return this.messages.filter((message) => message.threadId === threadId).slice(-limit);
  }

  public async findMessage(messageId: string) {
    return this.messages.find((message) => message.id === messageId) ?? null;
  }

  public async hasMessagesAfter(message: Message) {
    const index = this.messages.findIndex((candidate) => candidate.id === message.id);
    return this.messages
      .slice(index + 1)
      .some((candidate) => candidate.threadId === message.threadId);
  }

  public async listMessagePage(input: {
    threadId: string;
    limit: number;
    before?: MessagePageCursor;
  }) {
    const newestFirst = this.messages
      .filter((message) => message.threadId === input.threadId)
      .reverse();
    const start = input.before
      ? Math.max(0, newestFirst.findIndex((message) => message.id === input.before?.id) + 1)
      : 0;
    const messages = newestFirst.slice(start, start + input.limit);
    const hasMore = newestFirst.length > start + input.limit;
    const oldest = messages.at(-1);

    return {
      messages,
      nextCursor: hasMore && oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null,
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
    yield { type: "delta" as const, text: "Hello " };
    yield { type: "delta" as const, text: "there." };
    yield {
      type: "usage" as const,
      usage: { inputTokens: 12, outputTokens: 4 },
    };
  }
}

class InterruptedAssistant implements AssistantGateway {
  public readonly provider = "test";
  public readonly model = "interrupted";

  public async *streamReply(_input: AssistantInput) {
    yield { type: "delta" as const, text: "A useful partial answer" };
    throw new DOMException("Stopped", "AbortError");
  }
}

class FailsOnceAssistant implements AssistantGateway {
  public readonly provider = "test";
  public readonly model = "fails-once";
  private attempts = 0;

  public async *streamReply(_input: AssistantInput) {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "The provider is temporarily unavailable.",
        true,
      );
    }
    yield { type: "delta" as const, text: "Recovered." };
  }
}

const personalisation: PersonalisationStore = {
  async getProfile() {
    return structuredClone(defaultPersonalisationProfile);
  },
  async updateProfile(profile) {
    return profile;
  },
};

function createService(store: MemoryStore, assistant: AssistantGateway) {
  const context = new ContextAssembler(store, {
    inputTokenBudget: 1_000,
    historyPageSize: 10,
  });
  return new ChatService(store, store, assistant, context, personalisation, {
    provider: assistant.provider,
    model: assistant.model,
    contextInputTokenBudget: 1_000,
  });
}

describe("ChatService", () => {
  it("starts a new titled thread and persists both sides of a streamed exchange", async () => {
    const store = new MemoryStore();
    const service = createService(store, new FixedAssistant());
    const events = [];

    for await (const event of service.reply({ content: "Are you awake?" })) {
      events.push(event);
    }

    expect(store.threads[0]?.title).toBe("Are you awake?");
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

  it("persists partial output as cancelled", async () => {
    const store = new MemoryStore();
    const service = createService(store, new InterruptedAssistant());
    const events = [];

    for await (const event of service.reply({ content: "Begin a long answer" })) {
      events.push(event);
    }

    expect(store.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "A useful partial answer",
      status: "cancelled",
    });
    expect(events.at(-1)).toMatchObject({
      type: "cancelled",
      partial: true,
      retryable: false,
      assistantMessage: {
        content: "A useful partial answer",
        status: "cancelled",
      },
    });
  });

  it("retries a pre-output provider failure without duplicating the user message", async () => {
    const store = new MemoryStore();
    const service = createService(store, new FailsOnceAssistant());
    const firstEvents = [];

    for await (const event of service.reply({ content: "Try this once" })) {
      firstEvents.push(event);
    }

    const problem = firstEvents.at(-1);
    expect(problem).toMatchObject({ type: "error", retryable: true, partial: false });
    if (!problem || problem.type !== "error" || !problem.userMessageId) {
      throw new Error("Expected a retryable generation error.");
    }
    const thread = store.threads[0];
    if (!thread) throw new Error("Expected a conversation.");

    const retryEvents = [];
    for await (const event of service.retry({
      threadId: thread.id,
      userMessageId: problem.userMessageId,
    })) {
      retryEvents.push(event);
    }

    expect(store.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(store.messages.at(-1)?.content).toBe("Recovered.");
    expect(retryEvents.map((event) => event.type)).toEqual([
      "thread",
      "delta",
      "assistant_message",
      "done",
    ]);
  });

  it("returns history metadata without selecting an old thread for startup", async () => {
    const store = new MemoryStore();
    const service = createService(store, new FixedAssistant());
    for await (const _event of service.reply({ content: "Stored history" })) {
      // Consume the stream.
    }

    const home = await service.getHomeState();
    expect(home.threads).toHaveLength(1);
    expect(home.threads[0]).toMatchObject({
      title: "Stored history",
      messageCount: 2,
    });
    expect(home).not.toHaveProperty("thread");
    expect(home).not.toHaveProperty("messages");
  });

  it("keeps twenty representative conversations isolated and duplicate-free", async () => {
    const prompts = [
      "Give me a concise status update.",
      "Plan tomorrow's three priorities.",
      "Explain this in plain English.",
      "Draft a friendly reply with a clear next step.",
      "Compare option A with option B.",
      "Summarise:\n- first point\n- second point",
      "Use UK spelling and metric units.",
      "What does `status: complete` mean?",
      "Keep the quoted phrase “not yet decided” intact.",
      "Help me think through a reversible decision.",
      "List the assumptions you are making.",
      "Turn this idea into a small checklist.",
      "Explain the trade-off without jargon.",
      "What should I verify before continuing?",
      "Give me one recommendation and one caveat.",
      "Rewrite this with a warmer tone.",
      "Sketch a safe rollback plan.",
      "Find the likely edge case in this flow.",
      "Summarise the decision for future reference.",
      "End with the single best next action.",
    ];
    const store = new MemoryStore();
    const service = createService(store, new FixedAssistant());

    for (const prompt of prompts) {
      const events = [];
      for await (const event of service.reply({ content: prompt })) {
        events.push(event);
      }
      expect(events.filter((event) => event.type === "user_message")).toHaveLength(1);
      expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    }

    expect(store.threads).toHaveLength(20);
    expect(store.messages).toHaveLength(40);
    for (const conversation of store.threads) {
      const persisted = store.messages.filter((message) => message.threadId === conversation.id);
      expect(persisted.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(new Set(persisted.map((message) => message.id)).size).toBe(2);
    }

    const home = await service.getHomeState();
    expect(home.threads).toHaveLength(20);
    expect(home).not.toHaveProperty("thread");
    expect(home).not.toHaveProperty("messages");
  });
});

describe("deriveThreadTitle", () => {
  it("normalises whitespace and truncates on a word boundary", () => {
    expect(deriveThreadTitle("  A   short\n title ")).toBe("A short title");
    expect(
      deriveThreadTitle(
        "This is a deliberately long opening message that should become a tidy conversation title",
      ),
    ).toBe("This is a deliberately long opening message that should…");
  });
});
