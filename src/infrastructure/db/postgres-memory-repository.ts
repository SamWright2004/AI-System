import type {
  ExtractedMemoryDraft,
  MemoryDraft,
  MemoryItem,
  MemoryRepository,
  MemoryStatus,
} from "../../core/memory/types.js";
import type { DatabasePool } from "./pool.js";

interface MemoryRow {
  id: string;
  kind: MemoryItem["kind"];
  subject: string;
  content: string;
  status: MemoryItem["status"];
  confidence: number | string;
  importance: number;
  sensitivity: number;
  rationale: string;
  source_type: string;
  source_id: string | null;
  supersedes_id: string | null;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  last_confirmed_at: Date | string | null;
  extraction_metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  source_excerpt: string | null;
  source_thread_id: string | null;
  source_thread_title: string | null;
}

const memoryColumns = [
  "memory.id",
  "memory.kind",
  "memory.subject",
  "memory.content",
  "memory.status",
  "memory.confidence",
  "memory.importance",
  "memory.sensitivity",
  "memory.rationale",
  "memory.source_type",
  "memory.source_id",
  "memory.supersedes_id",
  "memory.valid_from",
  "memory.valid_until",
  "memory.last_confirmed_at",
  "memory.extraction_metadata",
  "memory.created_at",
  "memory.updated_at",
  "LEFT(source_message.content, 500) AS source_excerpt",
  "source_thread.id AS source_thread_id",
  "source_thread.title AS source_thread_title",
].join(", ");

const memoryJoins = [
  "LEFT JOIN messages AS source_message",
  "  ON memory.source_type IN ('message', 'owner_edited_message')",
  "  AND source_message.id = memory.source_id",
  "LEFT JOIN threads AS source_thread",
  "  ON source_thread.id = source_message.thread_id",
].join("\n");

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asOptionalIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function extractionValue(metadata: Record<string, unknown>, key: "provider" | "model") {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function mapMemory(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    status: row.status,
    confidence: Number(row.confidence),
    importance: row.importance,
    sensitivity: row.sensitivity,
    rationale: row.rationale,
    source: {
      type: row.source_type,
      id: row.source_id,
      excerpt: row.source_excerpt,
      threadId: row.source_thread_id,
      threadTitle: row.source_thread_title,
    },
    supersedesId: row.supersedes_id,
    validFrom: asOptionalIso(row.valid_from),
    validUntil: asOptionalIso(row.valid_until),
    lastConfirmedAt: asOptionalIso(row.last_confirmed_at),
    extraction: {
      provider: extractionValue(row.extraction_metadata, "provider"),
      model: extractionValue(row.extraction_metadata, "model"),
    },
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

export class PostgresMemoryRepository implements MemoryRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async listMemories(
    statuses: ReadonlyArray<MemoryStatus>,
    limit = 100,
  ): Promise<MemoryItem[]> {
    const result = await this.pool.query<MemoryRow>(
      "SELECT " +
        memoryColumns +
        " FROM memory_items AS memory " +
        memoryJoins +
        " WHERE memory.status = ANY($1::memory_status[])" +
        " ORDER BY memory.updated_at DESC, memory.id DESC LIMIT $2",
      [statuses, limit],
    );
    return result.rows.map(mapMemory);
  }

  public async countMemories(): Promise<Record<MemoryStatus, number>> {
    const counts: Record<MemoryStatus, number> = {
      proposed: 0,
      active: 0,
      superseded: 0,
      rejected: 0,
    };
    const result = await this.pool.query<{ status: MemoryStatus; count: number }>(
      "SELECT status, COUNT(*)::int AS count FROM memory_items GROUP BY status",
    );
    for (const row of result.rows) counts[row.status] = row.count;
    return counts;
  }

  public async findMemory(id: string): Promise<MemoryItem | null> {
    const result = await this.pool.query<MemoryRow>(
      "SELECT " +
        memoryColumns +
        " FROM memory_items AS memory " +
        memoryJoins +
        " WHERE memory.id = $1",
      [id],
    );
    return result.rows[0] ? mapMemory(result.rows[0]) : null;
  }

  public async addProposals(input: {
    threadId: string;
    proposals: ReadonlyArray<ExtractedMemoryDraft>;
    provider: string;
    model: string;
  }): Promise<{ created: number; skipped: number }> {
    if (input.proposals.length === 0) return { created: 0, skipped: 0 };

    const client = await this.pool.connect();
    let created = 0;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
        input.threadId,
      ]);
      for (const proposal of input.proposals) {
        const result = await client.query<{ id: string }>(
          [
            "INSERT INTO memory_items (",
            "  kind, subject, content, status, confidence, importance, sensitivity,",
            "  source_type, source_id, rationale, extraction_metadata",
            ")",
            "SELECT $3, $4, $5, 'proposed', $6, $7, $8, 'message', source.id, $9, $10",
            "FROM messages AS source",
            "WHERE source.id = $1",
            "  AND source.thread_id = $2",
            "  AND source.role = 'user'",
            "  AND source.status = 'complete'",
            "  AND NOT EXISTS (",
            "    SELECT 1 FROM memory_items AS existing",
            "    WHERE existing.source_type IN ('message', 'owner_edited_message')",
            "      AND existing.source_id = source.id",
            "      AND existing.kind = $3",
            "      AND lower(existing.subject) = lower($4)",
            "      AND existing.content = $5",
            "  )",
            "RETURNING id",
          ].join("\n"),
          [
            proposal.sourceMessageId,
            input.threadId,
            proposal.kind,
            proposal.subject,
            proposal.content,
            proposal.confidence,
            proposal.importance,
            proposal.sensitivity,
            proposal.rationale,
            {
              provider: input.provider,
              model: input.model,
              extractedAt: new Date().toISOString(),
            },
          ],
        );
        created += result.rowCount ?? 0;
      }

      if (created > 0) {
        await client.query(
          [
            "INSERT INTO activity_items (",
            "  dedupe_key, kind, title, body, status, requires_review, related_type, metadata",
            ")",
            "VALUES ($1, 'review', 'Memory review waiting', $2, 'unread', true, 'memory_review', $3)",
            "ON CONFLICT (dedupe_key) DO UPDATE",
            "SET body = EXCLUDED.body,",
            "    status = 'unread',",
            "    requires_review = true,",
            "    updated_at = now()",
          ].join("\n"),
          [
            "memory-review:" + input.threadId,
            created === 1
              ? "I found one possible memory. It will not affect replies until you approve it."
              : "I found " +
                created +
                " possible memories. None will affect replies until you approve them.",
            { threadId: input.threadId, created },
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return { created, skipped: input.proposals.length - created };
  }

  public async createOwnerMemory(input: MemoryDraft): Promise<MemoryItem> {
    const client = await this.pool.connect();
    let id: string | undefined;
    try {
      await client.query("BEGIN");
      const previous = await client.query<{ id: string }>(
        [
          "UPDATE memory_items",
          "SET status = 'superseded', valid_until = COALESCE(valid_until, now()), updated_at = now()",
          "WHERE status = 'active' AND kind = $1 AND lower(subject) = lower($2)",
          "RETURNING id",
        ].join("\n"),
        [input.kind, input.subject],
      );
      const inserted = await client.query<{ id: string }>(
        [
          "INSERT INTO memory_items (",
          "  kind, subject, content, status, confidence, importance, sensitivity,",
          "  source_type, supersedes_id, valid_from, last_confirmed_at, rationale",
          ")",
          "VALUES ($1, $2, $3, 'active', 1, $4, $5, 'owner', $6, now(), now(), $7)",
          "RETURNING id",
        ].join("\n"),
        [
          input.kind,
          input.subject,
          input.content,
          input.importance,
          input.sensitivity,
          previous.rows[0]?.id ?? null,
          "Added directly and explicitly by the owner.",
        ],
      );
      id = inserted.rows[0]?.id;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!id) throw new Error("Failed to create the memory.");
    const memory = await this.findMemory(id);
    if (!memory) throw new Error("The created memory could not be reloaded.");
    return memory;
  }

  public async updateProposedMemory(id: string, input: MemoryDraft): Promise<MemoryItem | null> {
    const result = await this.pool.query<{ id: string }>(
      [
        "UPDATE memory_items",
        "SET kind = $2,",
        "    subject = $3,",
        "    content = $4,",
        "    importance = $5,",
        "    sensitivity = $6,",
        "    confidence = 1,",
        "    source_type = CASE",
        "      WHEN source_type = 'message' THEN 'owner_edited_message'",
        "      ELSE source_type",
        "    END,",
        "    rationale = CASE",
        "      WHEN rationale = '' THEN 'Edited by the owner before approval.'",
        "      ELSE rationale || ' Edited by the owner before approval.'",
        "    END,",
        "    updated_at = now()",
        "WHERE id = $1 AND status = 'proposed'",
        "RETURNING id",
      ].join("\n"),
      [id, input.kind, input.subject, input.content, input.importance, input.sensitivity],
    );
    return result.rows[0] ? this.findMemory(result.rows[0].id) : null;
  }

  public async supersedeActiveMemory(id: string, input: MemoryDraft): Promise<MemoryItem | null> {
    const client = await this.pool.connect();
    let replacementId: string | undefined;
    try {
      await client.query("BEGIN");
      const current = await client.query<{ id: string }>(
        "SELECT id FROM memory_items WHERE id = $1 AND status = 'active' FOR UPDATE",
        [id],
      );
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        [
          "UPDATE memory_items",
          "SET status = 'superseded', valid_until = COALESCE(valid_until, now()), updated_at = now()",
          "WHERE status = 'active'",
          "  AND (id = $1 OR (kind = $2 AND lower(subject) = lower($3)))",
        ].join("\n"),
        [id, input.kind, input.subject],
      );
      const inserted = await client.query<{ id: string }>(
        [
          "INSERT INTO memory_items (",
          "  kind, subject, content, status, confidence, importance, sensitivity,",
          "  source_type, source_id, supersedes_id, valid_from, last_confirmed_at, rationale",
          ")",
          "VALUES ($1, $2, $3, 'active', 1, $4, $5, 'memory_revision', $6, $6, now(), now(), $7)",
          "RETURNING id",
        ].join("\n"),
        [
          input.kind,
          input.subject,
          input.content,
          input.importance,
          input.sensitivity,
          id,
          "Revised and confirmed explicitly by the owner.",
        ],
      );
      replacementId = inserted.rows[0]?.id;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return replacementId ? this.findMemory(replacementId) : null;
  }

  public async approveMemory(id: string): Promise<MemoryItem | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{ id: string; kind: string; subject: string }>(
        [
          "SELECT id, kind, subject",
          "FROM memory_items",
          "WHERE id = $1 AND status = 'proposed'",
          "FOR UPDATE",
        ].join("\n"),
        [id],
      );
      const row = target.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const previous = await client.query<{ id: string }>(
        [
          "UPDATE memory_items",
          "SET status = 'superseded', valid_until = COALESCE(valid_until, now()), updated_at = now()",
          "WHERE status = 'active'",
          "  AND kind = $1::memory_kind",
          "  AND lower(subject) = lower($2)",
          "RETURNING id",
        ].join("\n"),
        [row.kind, row.subject],
      );
      await client.query(
        [
          "UPDATE memory_items",
          "SET status = 'active',",
          "    supersedes_id = COALESCE($2, supersedes_id),",
          "    valid_from = COALESCE(valid_from, now()),",
          "    last_confirmed_at = now(),",
          "    updated_at = now()",
          "WHERE id = $1",
        ].join("\n"),
        [id, previous.rows[0]?.id ?? null],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.resolveReviewIfSettled(await this.findSourceThreadId(id)).catch(() => undefined);
    return this.findMemory(id);
  }

  public async rejectMemory(id: string): Promise<MemoryItem | null> {
    const result = await this.pool.query<{ id: string }>(
      [
        "UPDATE memory_items",
        "SET status = 'rejected', updated_at = now()",
        "WHERE id = $1 AND status = 'proposed'",
        "RETURNING id",
      ].join("\n"),
      [id],
    );
    const updatedId = result.rows[0]?.id;
    if (!updatedId) return null;
    await this.resolveReviewIfSettled(await this.findSourceThreadId(updatedId)).catch(
      () => undefined,
    );
    return this.findMemory(updatedId);
  }

  public async forgetMemory(id: string): Promise<boolean> {
    const sourceThreadId = await this.findSourceThreadId(id);
    const result = await this.pool.query("DELETE FROM memory_items WHERE id = $1", [id]);
    if (result.rowCount === 1) {
      await this.resolveReviewIfSettled(sourceThreadId).catch(() => undefined);
    }
    return result.rowCount === 1;
  }

  public async searchActiveMemories(input: {
    query: string;
    limit: number;
    maxSensitivity: number;
  }): Promise<MemoryItem[]> {
    const result = await this.pool.query<MemoryRow & { lexical_rank: number | string }>(
      [
        "SELECT " + memoryColumns + ",",
        "  ts_rank_cd(",
        "    to_tsvector('simple', memory.subject || ' ' || memory.content),",
        "    websearch_to_tsquery('simple', $1)",
        "  ) AS lexical_rank",
        "FROM memory_items AS memory",
        memoryJoins,
        "WHERE memory.status = 'active'",
        "  AND memory.sensitivity <= $2",
        "  AND (",
        "    memory.importance >= 75",
        "    OR to_tsvector('simple', memory.subject || ' ' || memory.content)",
        "       @@ websearch_to_tsquery('simple', $1)",
        "  )",
        "ORDER BY lexical_rank DESC,",
        "  memory.importance DESC,",
        "  memory.confidence DESC,",
        "  memory.last_confirmed_at DESC NULLS LAST,",
        "  memory.updated_at DESC",
        "LIMIT $3",
      ].join("\n"),
      [input.query, input.maxSensitivity, input.limit],
    );
    return result.rows.map(mapMemory);
  }

  private async findSourceThreadId(id: string): Promise<string | null> {
    const result = await this.pool.query<{ thread_id: string }>(
      [
        "SELECT source_message.thread_id",
        "FROM memory_items AS memory",
        "JOIN messages AS source_message",
        "  ON memory.source_type IN ('message', 'owner_edited_message')",
        "  AND source_message.id = memory.source_id",
        "WHERE memory.id = $1",
      ].join("\n"),
      [id],
    );
    return result.rows[0]?.thread_id ?? null;
  }

  private async resolveReviewIfSettled(threadId: string | null): Promise<void> {
    if (!threadId) return;
    await this.pool.query(
      [
        "UPDATE activity_items AS activity",
        "SET status = 'resolved', requires_review = false, updated_at = now()",
        "WHERE activity.dedupe_key = $1",
        "  AND NOT EXISTS (",
        "    SELECT 1",
        "    FROM memory_items AS pending",
        "    JOIN messages AS source_message",
        "      ON pending.source_type IN ('message', 'owner_edited_message')",
        "      AND source_message.id = pending.source_id",
        "    WHERE pending.status = 'proposed' AND source_message.thread_id = $2",
        "  )",
      ].join("\n"),
      ["memory-review:" + threadId, threadId],
    );
  }
}
