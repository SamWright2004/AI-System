CREATE INDEX IF NOT EXISTS memory_embeddings_provider_model_idx
  ON memory_embeddings (provider, model, dimensions, memory_id);

CREATE INDEX IF NOT EXISTS threads_project_updated_idx
  ON threads (project_id, updated_at DESC)
  WHERE project_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_status_updated_idx
  ON projects (status, updated_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON TABLE memory_embeddings IS
  'Disposable semantic ranking index. memory_items remains the canonical reviewed claim.';
COMMENT ON COLUMN threads.project_id IS
  'Explicit workspace selection. A normal fresh conversation remains unscoped.';
