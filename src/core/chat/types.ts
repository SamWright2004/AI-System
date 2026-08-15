export type ChatRole = "user" | "assistant";
export type MessageStatus = "complete" | "failed";

export interface Thread {
  id: string;
  title: string;
  kind: "primary" | "project" | "temporary";
  createdAt: string;
  updatedAt: string;
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
  ensurePrimaryThread(): Promise<Thread>;
  findThread(threadId: string): Promise<Thread | null>;
  listMessages(threadId: string, limit?: number): Promise<Message[]>;
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
  thread: Thread;
  messages: Message[];
  activity: ActivityItem[];
  personalisation: {
    ownerDisplayName: string | null;
    assistantDisplayName: string | null;
  };
}

export type ChatStreamEvent =
  | { type: "thread"; thread: Thread }
  | { type: "user_message"; message: Message }
  | { type: "delta"; text: string }
  | { type: "assistant_message"; message: Message }
  | { type: "done" }
  | { type: "error"; message: string };
