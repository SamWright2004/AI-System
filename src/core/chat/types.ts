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
  createdAt: string;
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
  signal?: AbortSignal;
}

export interface AssistantGateway {
  readonly provider: string;
  readonly model: string;
  streamReply(input: AssistantInput): AsyncIterable<string>;
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
}

export type ChatStreamEvent =
  | { type: "thread"; thread: Thread }
  | { type: "user_message"; message: Message }
  | { type: "delta"; text: string }
  | { type: "assistant_message"; message: Message }
  | { type: "done" }
  | { type: "error"; message: string };
