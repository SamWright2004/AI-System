import type {
  ActivityItem,
  ActivityRepository,
  ConversationRepository,
  Message,
  Thread,
} from "../../core/chat/types.js";
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

interface ActivityRow {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  body: string;
  status: ActivityItem["status"];
  requires_review: boolean;
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

function mapActivity(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    requiresReview: row.requires_review,
    createdAt: asIso(row.created_at),
  };
}

export class PostgresStore implements ConversationRepository, ActivityRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async ensurePrimaryThread(): Promise<Thread> {
    await this.pool.query(
      `INSERT INTO threads (title, kind)
       VALUES ('Home', 'primary')
       ON CONFLICT DO NOTHING`,
    );

    const result = await this.pool.query<ThreadRow>(
      `SELECT id, title, kind, created_at, updated_at
       FROM threads
       WHERE kind = 'primary' AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create the primary conversation.");
    }

    return mapThread(row);
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

  public async listMessages(threadId: string, limit = 100): Promise<Message[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
       FROM (
         SELECT id, thread_id, role, content, status, provider, model, input_tokens, output_tokens, metadata, created_at
         FROM messages
         WHERE thread_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) recent
       ORDER BY created_at ASC`,
      [threadId, limit],
    );
    return result.rows.map(mapMessage);
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
      `SELECT id, kind, title, body, status, requires_review, created_at
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
