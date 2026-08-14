CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE thread_kind AS ENUM ('primary', 'project', 'temporary');
CREATE TYPE message_role AS ENUM ('user', 'assistant');
CREATE TYPE message_status AS ENUM ('complete', 'failed');
CREATE TYPE activity_kind AS ENUM ('progress', 'review', 'decision', 'warning', 'completed');
CREATE TYPE activity_status AS ENUM ('unread', 'read', 'resolved');
CREATE TYPE project_status AS ENUM ('idea', 'active', 'paused', 'completed', 'archived');
CREATE TYPE task_status AS ENUM ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled');
CREATE TYPE memory_kind AS ENUM ('fact', 'preference', 'relationship', 'project', 'routine', 'decision', 'working');
CREATE TYPE memory_status AS ENUM ('proposed', 'active', 'superseded', 'rejected');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled');
CREATE TYPE tool_risk AS ENUM ('read', 'draft', 'write_reversible', 'external_commit', 'destructive');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled');

CREATE TABLE system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind thread_kind NOT NULL DEFAULT 'temporary',
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX one_active_primary_thread
  ON threads (kind)
  WHERE kind = 'primary' AND archived_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role message_role NOT NULL,
  content text NOT NULL,
  status message_status NOT NULL DEFAULT 'complete',
  provider text,
  model text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_thread_time_idx ON messages (thread_id, created_at DESC);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status project_status NOT NULL DEFAULT 'idea',
  workspace_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

ALTER TABLE threads
  ADD CONSTRAINT threads_project_fk
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status task_status NOT NULL DEFAULT 'backlog',
  priority smallint NOT NULL DEFAULT 0,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX tasks_project_status_idx ON tasks (project_id, status, priority DESC);

CREATE TABLE activity_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text UNIQUE,
  kind activity_kind NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  status activity_status NOT NULL DEFAULT 'unread',
  requires_review boolean NOT NULL DEFAULT false,
  related_type text,
  related_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_status_time_idx ON activity_items (status, created_at DESC);

CREATE TABLE memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind memory_kind NOT NULL,
  subject text NOT NULL,
  content text NOT NULL,
  status memory_status NOT NULL DEFAULT 'proposed',
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  importance smallint NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 100),
  sensitivity smallint NOT NULL DEFAULT 0 CHECK (sensitivity BETWEEN 0 AND 3),
  source_type text NOT NULL,
  source_id uuid,
  supersedes_id uuid REFERENCES memory_items(id) ON DELETE SET NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  last_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_subject_status_idx ON memory_items (subject, status);
CREATE INDEX memory_kind_status_idx ON memory_items (kind, status);

CREATE TABLE memory_embeddings (
  memory_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, provider, model, dimensions)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  source_uri text NOT NULL,
  display_name text NOT NULL,
  mime_type text,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'indexed',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_uri, content_hash)
);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL,
  token_count integer CHECK (token_count IS NULL OR token_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (document_id, ordinal)
);

CREATE TABLE document_embeddings (
  chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, provider, model, dimensions)
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  parent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status run_status NOT NULL DEFAULT 'queued',
  objective text NOT NULL,
  provider text,
  model text,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_snapshot jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX agent_runs_status_time_idx ON agent_runs (status, created_at DESC);

CREATE TABLE tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  risk tool_risk NOT NULL,
  arguments jsonb NOT NULL,
  status text NOT NULL,
  result jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_invocation_id uuid REFERENCES tool_invocations(id) ON DELETE CASCADE,
  status approval_status NOT NULL DEFAULT 'pending',
  summary text NOT NULL,
  consequences text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX approvals_pending_idx ON approval_requests (status, requested_at)
  WHERE status = 'pending';

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_ready_idx ON outbox_events (available_at, created_at)
  WHERE processed_at IS NULL;

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE memory_items IS 'Canonical, reviewable personal memory; raw chat history is not equivalent to memory.';
COMMENT ON TABLE audit_events IS 'Append-only record of consequential system actions.';
COMMENT ON TABLE outbox_events IS 'Transactional seam between the modular monolith and durable background work.';
