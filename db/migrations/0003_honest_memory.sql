ALTER TABLE memory_items
  ADD COLUMN IF NOT EXISTS rationale text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extraction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY kind, lower(subject)
      ORDER BY last_confirmed_at DESC NULLS LAST, updated_at DESC, id DESC
    ) AS active_rank
  FROM memory_items
  WHERE status = 'active'
)
UPDATE memory_items AS memory
SET status = 'superseded',
    valid_until = COALESCE(memory.valid_until, now()),
    updated_at = now()
FROM ranked_active
WHERE memory.id = ranked_active.id
  AND ranked_active.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_memory_per_subject_kind
  ON memory_items (kind, lower(subject))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS memory_items_full_text_idx
  ON memory_items
  USING gin (to_tsvector('simple', subject || ' ' || content));

CREATE INDEX IF NOT EXISTS memory_review_queue_idx
  ON memory_items (created_at DESC)
  WHERE status = 'proposed';

COMMENT ON COLUMN memory_items.rationale IS
  'Short evidence-based explanation shown to the owner; never hidden chain-of-thought.';
COMMENT ON COLUMN memory_items.extraction_metadata IS
  'Provider and model provenance for proposed-memory extraction.';

UPDATE activity_items
SET kind = 'completed',
    title = 'Honest memory is ready',
    body = 'Conversation review now creates sourced proposals. Nothing enters future replies until you approve it in Memory.',
    requires_review = false,
    updated_at = now()
WHERE dedupe_key = 'memory-deliberate';
