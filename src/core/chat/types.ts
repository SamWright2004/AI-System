import type { PersonalisationProfile } from "../settings/types.js";

export type ChatRole = "user" | "assistant";
export type MessageStatus = "complete" | "cancelled" | "failed";

export interface Thread {
  id: string;
  title: string;
  kind: "primary" | "project" | "temporary";
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSummary extends Thread {
  messageCount: number;
  lastMessagePreview: string | null;
}

export interface Message {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MessagePageCursor {
  createdAt: string;
  id: string;
}

export interface MessagePage {
  /** Messages are ordered newest first for efficient backward context assembly. */
  messages: Message[];
  nextCursor: MessagePageCursor | null;
}

export interface ActivityItem {
  id: string;
  kind: "progress" | "review" | "decision" | "warning" | "completed";
  title: string;
  body: string;
  status: "unread" | "read" | "resolved";
  requiresReview: boolean;
  createdAt: string;
}

export interface AssistantInput {
  messages: ReadonlyArray<Pick<Message, "role" | "content">>;
  context: ReadonlyArray<AssistantContextBlock>;
  signal?: AbortSignal;
}

export interface AssistantContextBlock {
  id: string;
  source: string;
  title: string;
  /**
   * Trust is explicit so adapters can tell the model whether a block is an
   * owner preference, canonical application state, or untrusted evidence.
   */
  trust: "owner" | "application" | "external";
  content: string;
}

export interface AssistantUsage {
  inputTokens?: number;
  outputTokens?: number;
  providerTotalMs?: number;
  providerLoadMs?: number;
  providerPromptEvalMs?: number;
  providerGenerationMs?: number;
}

export type AssistantStreamChunk =
  { type: "delta"; text: string } | { type: "usage"; usage: AssistantUsage };

export interface AssistantGateway {
  readonly provider: string;
  readonly model: string;
  streamReply(input: AssistantInput): AsyncIterable<AssistantStreamChunk>;
}

export interface ConversationRepository {
  createThread(input: { title: string; kind?: Thread["kind"] }): Promise<Thread>;
  findThread(threadId: string): Promise<Thread | null>;
  listThreads(limit?: number): Promise<ThreadSummary[]>;
  updateThreadTitle(threadId: string, title: string): Promise<Thread | null>;
  archiveThread(threadId: string): Promise<boolean>;
  listMessages(threadId: string, limit?: number): Promise<Message[]>;
  findMessage(messageId: string): Promise<Message | null>;
  hasMessagesAfter(message: Message): Promise<boolean>;
  addMessage(input: {
    threadId: string;
    role: ChatRole;
    content: string;
    status?: MessageStatus;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Message>;
}

export interface ActivityRepository {
  listRecent(limit?: number): Promise<ActivityItem[]>;
  markRead(id: string): Promise<void>;
}

export interface HomeState {
  threads: ThreadSummary[];
  activity: ActivityItem[];
  personalisation: PersonalisationProfile;
  runtime: {
    provider: string;
    model: string;
    contextInputTokenBudget: number;
  };
}

export interface ThreadState {
  thread: Thread;
  messages: Message[];
}

export interface GenerationProblem {
  code: string;
  message: string;
  retryable: boolean;
  userMessageId: string | null;
  partial: boolean;
}

export type ChatStreamEvent =
  | { type: "thread"; thread: Thread }
  | { type: "user_message"; message: Message }
  | { type: "delta"; text: string }
  | { type: "assistant_message"; message: Message }
  | { type: "done" }
  | ({ type: "cancelled" } & GenerationProblem & { message?: Message })
  | ({ type: "error" } & GenerationProblem & { message?: Message });
