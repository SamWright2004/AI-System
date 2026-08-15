import { NotFoundError } from "../../shared/errors.js";
import type {
  AssembledContext,
  ConversationContextAssembler,
  PersonalisationReader,
} from "../context/types.js";
import type {
  ActivityRepository,
  AssistantGateway,
  ChatStreamEvent,
  ConversationRepository,
  HomeState,
  AssistantUsage,
} from "./types.js";

function addProviderTiming(timing: Record<string, number | null>, usage?: AssistantUsage) {
  if (usage?.providerTotalMs !== undefined) {
    timing.providerTotalMs = usage.providerTotalMs;
  }

  if (usage?.providerLoadMs !== undefined) {
    timing.providerLoadMs = usage.providerLoadMs;
  }

  if (usage?.providerPromptEvalMs !== undefined) {
    timing.providerPromptEvalMs = usage.providerPromptEvalMs;
  }

  if (usage?.providerGenerationMs !== undefined) {
    timing.providerGenerationMs = usage.providerGenerationMs;
  }
}

export class ChatService {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly activity: ActivityRepository,
    private readonly assistant: AssistantGateway,
    private readonly contextAssembler: ConversationContextAssembler,
    private readonly personalisation?: PersonalisationReader,
  ) {}

  public async getHomeState(): Promise<HomeState> {
    const thread = await this.conversations.ensurePrimaryThread();
    const [messages, activity, personalisation] = await Promise.all([
      this.conversations.listMessages(thread.id, 100),
      this.activity.listRecent(12),
      this.personalisation?.getSummary() ??
        Promise.resolve({ ownerDisplayName: null, assistantDisplayName: null }),
    ]);

    return { thread, messages, activity, personalisation };
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

    let completeText = "";
    let usage: AssistantUsage | undefined;
    let context: AssembledContext | undefined;
    let contextAssemblyMs: number | undefined;
    let modelStartedAt: number | undefined;
    let firstTokenMs: number | null = null;

    try {
      const contextStartedAt = performance.now();
      context = await this.contextAssembler.assemble({
        thread,
        currentMessage: userMessage,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      contextAssemblyMs = Math.round(performance.now() - contextStartedAt);
      modelStartedAt = performance.now();

      for await (const chunk of this.assistant.streamReply({
        messages: context.messages,
        context: context.blocks,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        if (chunk.type === "usage") {
          usage = chunk.usage;
          continue;
        }

        if (firstTokenMs === null) {
          firstTokenMs = Math.round(performance.now() - modelStartedAt);
        }

        completeText += chunk.text;
        yield { type: "delta", text: chunk.text };
      }

      const wallMs = Math.round(performance.now() - modelStartedAt);

      const timing: Record<string, number | null> = {
        contextAssemblyMs,
        wallMs,
        firstTokenMs,
      };
      addProviderTiming(timing, usage);

      const assistantMessage = await this.conversations.addMessage({
        threadId: thread.id,
        role: "assistant",
        content: completeText,
        provider: this.assistant.provider,
        model: this.assistant.model,
        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
        metadata: {
          timing,
          context: context.diagnostics,
        },
      });

      yield { type: "assistant_message", message: assistantMessage };
      yield { type: "done" };
    } catch (error) {
      if (completeText.trim()) {
        const timing: Record<string, number | null> = {
          contextAssemblyMs: contextAssemblyMs ?? null,
          wallMs:
            modelStartedAt !== undefined ? Math.round(performance.now() - modelStartedAt) : null,
          firstTokenMs,
        };
        addProviderTiming(timing, usage);

        await this.conversations.addMessage({
          threadId: thread.id,
          role: "assistant",
          content: completeText,
          status: "failed",
          provider: this.assistant.provider,
          model: this.assistant.model,
          ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
          ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
          metadata: {
            timing,
            ...(context ? { context: context.diagnostics } : {}),
          },
        });
      }

      const message = error instanceof Error ? error.message : "The response stopped unexpectedly.";
      yield { type: "error", message };
    }
  }
}
