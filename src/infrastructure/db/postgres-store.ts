import type {
  ActivityItem,
  ActivityRepository,
  ConversationRepository,
  Message,
  MessagePage,
  MessagePageCursor,
  Thread,
  ThreadSummary,
} from "../../core/chat/types.js";
import type { ContextHistoryRepository } from "../../core/context/types.js";
import type { DatabasePool } from "./pool.js";

interface ThreadRow {
  id: string;
  title: string;
  kind: Thread["kind"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: Message["role"];
  content: string;
  status: Message["status"];
  provider: string | null;
  model: string | null;
  created_at: Date | string;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: Record<string, unknown>;
}

interface ThreadSummaryRow extends ThreadRow {
  message_count: number;
  last_message_preview: string | null;
}

interface ActivityRow {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  body: string;
  status: ActivityItem["status"];
  requires_review: boolean;
  related_type: string | null;
  related_id: string | null;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    status: row.status,
    provider: row.provider,
    model: row.model,
    createdAt: asIso(row.created_at),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    metadata: row.metadata,
  };
}

function mapThreadSummary(row: ThreadSummaryRow): ThreadSummary {
  return {
    ...mapThread(row),
    messageCount: row.message_count,
    lastMessagePreview: row.last_message_preview,
  };
}

function mapActivity(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    requiresReview: row.requires_review,
    relatedType: row.related_type,
    relatedId: row.related_id,
    createdAt: asIso(row.created_at),
  };
}

export class PostgresStore
  implements ConversationRepository, ActivityRepository, ContextHistoryRepository
{
  public constructor(private readonly pool: DatabasePool) {}

  public async createThread(input: { title: string; kind?: Thread["kind"] }): Promise<Thread> {
    const result = await this.pool.query<ThreadRow>(
      `INSERT INTO threads (title, kind)
       VALUES ($1, $2)
       RETURNING id, title, kind, created_at, updated_at`,
      [input.title, input.kind ?? "temporary"],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create the conversation.");
    }

    return mapThread(row);
  }

  public async listThreads(limit = 80): Promise<ThreadSummary[]> {
    const result = await this.pool.query<ThreadSummaryRow>(
      `SELECT
         thread.id,
         thread.title,
         thread.kind,
         thread.created_at,
         thread.updated_at,
         (
           SELECT COUNT(*)::int
           FROM messages
           WHERE messages.thread_id = thread.id
         ) AS message_count,
         (
           SELECT LEFT(message.content, 160)
           FROM messages AS message
           WHERE message.thread_id = thread.id
           ORDER BY message.created_at DESC, message.id DESC
           LIMIT 1
         ) AS last_message_preview
       FROM threads AS thread
       WHERE thread.archived_at IS NULL
       ORDER BY thread.updated_at DESC, thread.id DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapThreadSummary);
  }

  public async findThread(threadId: string): Promise<Thread | null> {
    const result = await this.pool.query<ThreadRow>(
      `SELECT id, title, kind, created_at, updated_at
       FROM threads
       WHERE id = $1 AND archived_at IS NULL`,
      [threadId],
    );
    return result.rows[0] ? mapThread(result.rows[0]) : null;
  }

  public async updateThreadTitle(threadId: string, title: string): Promise<Thread | null> {
    const result = await this.pool.query<ThreadRow>(
      `UPDATE threads
       SET title = $2, updated_at = now()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, title, kind, created_at, updated_at`,
      [threadId, title],
    );
    return result.rows[0] ? mapThread(result.rows[0]) : null;
  }

  public async archiveThread(threadId: string): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE threads
       SET archived_at = now(), updated_at = now()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id`,
      [threadId],
    );
    return result.rowCount === 1;
  }

  public async listMessages(threadId: string, limit = 100): Promise<Message[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
       FROM (
         SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
         FROM messages
         WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [threadId, limit],
    );
    return result.rows.map(mapMessage);
  }

  public async findMessage(messageId: string): Promise<Message | null> {
    const result = await this.pool.query<MessageRow>(
      `SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
       FROM messages
       WHERE id = $1`,
      [messageId],
    );
    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  public async hasMessagesAfter(message: Message): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM messages
         WHERE thread_id = $1
           AND (created_at, id) > ($2::timestamptz, $3::uuid)
       ) AS exists`,
      [message.threadId, message.createdAt, message.id],
    );
    return result.rows[0]?.exists ?? false;
  }

  public async listMessagePage(input: {
    threadId: string;
    limit: number;
    before?: MessagePageCursor;
  }): Promise<MessagePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error("Message page limit must be a positive integer.");
    }

    const result = await this.pool.query<MessageRow>(
      `SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
       FROM messages
       WHERE thread_id = $1
         AND (
           $2::timestamptz IS NULL
           OR (created_at, id) < ($2::timestamptz, $3::uuid)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [input.threadId, input.before?.createdAt ?? null, input.before?.id ?? null, input.limit + 1],
    );

    const hasMore = result.rows.length > input.limit;
    const messages = result.rows.slice(0, input.limit).map(mapMessage);
    const oldestMessage = messages.at(-1);

    return {
      messages,
      nextCursor:
        hasMore && oldestMessage
          ? { createdAt: oldestMessage.createdAt, id: oldestMessage.id }
          : null,
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
  }): Promise<Message> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO messages (thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at`,
      [
        input.threadId,
        input.role,
        input.content,
        input.status ?? "complete",
        input.provider ?? null,
        input.model ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.metadata ?? {},
      ],
    );

    await this.pool.query(`UPDATE threads SET updated_at = now() WHERE id = $1`, [input.threadId]);

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to save the message.");
    }
    return mapMessage(row);
  }

  public async listRecent(limit = 12): Promise<ActivityItem[]> {
    const result = await this.pool.query<ActivityRow>(
      `SELECT id, kind, title, body, status, requires_review, related_type, related_id, created_at
       FROM activity_items
       WHERE status <> 'resolved'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapActivity);
  }

  public async markRead(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE activity_items
       SET status = CASE WHEN status = 'unread' THEN 'read' ELSE status END,
           updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }
}
