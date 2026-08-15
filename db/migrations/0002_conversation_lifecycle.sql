ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'cancelled' AFTER 'complete';

CREATE INDEX IF NOT EXISTS threads_recent_active_idx
  ON threads (updated_at DESC)
  WHERE archived_at IS NULL;
