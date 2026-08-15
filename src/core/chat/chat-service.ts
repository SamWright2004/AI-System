import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PersonalisationStore } from "../settings/types.js";
import type { AssembledContext, ConversationContextAssembler } from "../context/types.js";
import { classifyGenerationError, isAbortError, ProviderError } from "./generation-errors.js";
import type {
  ActivityRepository,
  AssistantGateway,
  AssistantUsage,
  ChatStreamEvent,
  ConversationRepository,
  HomeState,
  Message,
  MessageStatus,
  Thread,
  ThreadState,
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

export function deriveThreadTitle(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  if (cleaned.length <= 58) return cleaned;

  const candidate = cleaned.slice(0, 57);
  const wordBoundary = candidate.replace(/\s+\S*$/, "").trim();
  return `${wordBoundary || candidate.trim()}…`;
}

export class ChatService {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly activity: ActivityRepository,
    private readonly assistant: AssistantGateway,
    private readonly contextAssembler: ConversationContextAssembler,
    private readonly personalisation: PersonalisationStore,
    private readonly runtime: HomeState["runtime"],
  ) {}

  public async getHomeState(): Promise<HomeState> {
    const [threads, activity, personalisation] = await Promise.all([
      this.conversations.listThreads(80),
      this.activity.listRecent(12),
      this.personalisation.getProfile(),
    ]);

    return { threads, activity, personalisation, runtime: this.runtime };
  }

  public async getThreadState(threadId: string): Promise<ThreadState> {
    const thread = await this.conversations.findThread(threadId);
    if (!thread) {
      throw new NotFoundError("That conversation no longer exists.");
    }

    return {
      thread,
      messages: await this.conversations.listMessages(thread.id, 500),
    };
  }

  public async renameThread(threadId: string, title: string): Promise<Thread> {
    const thread = await this.conversations.updateThreadTitle(threadId, title.trim());
    if (!thread) {
      throw new NotFoundError("That conversation no longer exists.");
    }
    return thread;
  }

  public async archiveThread(threadId: string): Promise<void> {
    if (!(await this.conversations.archiveThread(threadId))) {
      throw new NotFoundError("That conversation no longer exists.");
    }
  }

  public async *reply(input: {
    threadId?: string;
    content: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent> {
    input.signal?.throwIfAborted();

    const thread = input.threadId
      ? await this.conversations.findThread(input.threadId)
      : await this.conversations.createThread({
          title: deriveThreadTitle(input.content),
          kind: "temporary",
        });

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

    yield* this.generateReply(thread, userMessage, input.signal);
  }

  public async *retry(input: {
    threadId: string;
    userMessageId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent> {
    input.signal?.throwIfAborted();

    const [thread, userMessage] = await Promise.all([
      this.conversations.findThread(input.threadId),
      this.conversations.findMessage(input.userMessageId),
    ]);

    if (!thread || !userMessage || userMessage.threadId !== thread.id) {
      throw new NotFoundError("That retry target no longer exists.");
    }
    if (userMessage.role !== "user") {
      throw new ConflictError("Only a user message can be retried.");
    }
    if (await this.conversations.hasMessagesAfter(userMessage)) {
      throw new ConflictError(
        "This message already has a later response or conversation turn, so retrying it could create duplicates.",
      );
    }

    yield { type: "thread", thread };
    yield* this.generateReply(thread, userMessage, input.signal);
  }

  private async *generateReply(
    thread: Thread,
    userMessage: Message,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    let completeText = "";
    let usage: AssistantUsage | undefined;
    let context: AssembledContext | undefined;
    let contextAssemblyMs: number | undefined;
    let modelStartedAt: number | undefined;
    let firstTokenMs: number | null = null;
    let stage: "context" | "provider" = "context";

    try {
      signal?.throwIfAborted();
      const contextStartedAt = performance.now();
      context = await this.contextAssembler.assemble({
        thread,
        currentMessage: userMessage,
        ...(signal ? { signal } : {}),
      });
      contextAssemblyMs = Math.round(performance.now() - contextStartedAt);
      signal?.throwIfAborted();

      stage = "provider";
      modelStartedAt = performance.now();

      for await (const chunk of this.assistant.streamReply({
        messages: context.messages,
        context: context.blocks,
        ...(signal ? { signal } : {}),
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

      if (!completeText.trim()) {
        throw new ProviderError(
          "PROVIDER_EMPTY_RESPONSE",
          "The model returned an empty response. You can retry this message.",
          true,
        );
      }

      const assistantMessage = await this.saveAssistantMessage({
        thread,
        content: completeText,
        status: "complete",
        usage,
        context,
        contextAssemblyMs,
        modelStartedAt,
        firstTokenMs,
      });

      yield { type: "assistant_message", message: assistantMessage };
      yield { type: "done" };
    } catch (error) {
      const partial = Boolean(completeText.trim());

      if (isAbortError(error, signal)) {
        const assistantMessage = partial
          ? await this.saveAssistantMessage({
              thread,
              content: completeText,
              status: "cancelled",
              usage,
              context,
              contextAssemblyMs,
              modelStartedAt,
              firstTokenMs,
              error: { code: "CANCELLED", message: "Stopped by the owner." },
            })
          : undefined;

        yield {
          type: "cancelled",
          code: "CANCELLED",
          message: partial ? "Stopped. I kept the partial reply." : "Stopped before I replied.",
          retryable: !partial,
          userMessageId: userMessage.id,
          partial,
          ...(assistantMessage ? { assistantMessage } : {}),
        };
        return;
      }

      const problem = classifyGenerationError(error, stage);
      const assistantMessage = partial
        ? await this.saveAssistantMessage({
            thread,
            content: completeText,
            status: "failed",
            usage,
            context,
            contextAssemblyMs,
            modelStartedAt,
            firstTokenMs,
            error: { code: problem.code, message: problem.message },
          })
        : undefined;

      yield {
        type: "error",
        ...problem,
        retryable: problem.retryable && !partial,
        userMessageId: userMessage.id,
        partial,
        ...(assistantMessage ? { assistantMessage } : {}),
      };
    }
  }

  private async saveAssistantMessage(input: {
    thread: Thread;
    content: string;
    status: MessageStatus;
    usage: AssistantUsage | undefined;
    context: AssembledContext | undefined;
    contextAssemblyMs: number | undefined;
    modelStartedAt: number | undefined;
    firstTokenMs: number | null;
    error?: { code: string; message: string };
  }): Promise<Message> {
    const timing: Record<string, number | null> = {
      contextAssemblyMs: input.contextAssemblyMs ?? null,
      wallMs:
        input.modelStartedAt !== undefined
          ? Math.round(performance.now() - input.modelStartedAt)
          : null,
      firstTokenMs: input.firstTokenMs,
    };
    addProviderTiming(timing, input.usage);

    return this.conversations.addMessage({
      threadId: input.thread.id,
      role: "assistant",
      content: input.content,
      status: input.status,
      provider: this.assistant.provider,
      model: this.assistant.model,
      ...(input.usage?.inputTokens !== undefined ? { inputTokens: input.usage.inputTokens } : {}),
      ...(input.usage?.outputTokens !== undefined
        ? { outputTokens: input.usage.outputTokens }
        : {}),
      metadata: {
        timing,
        ...(input.context ? { context: input.context.diagnostics } : {}),
        ...(input.error ? { error: input.error } : {}),
      },
    });
  }
}
