# Data model

The initial migration creates more tables than the first screen uses. That is intentional: the expensive part
to change later is not adding a column, but discovering that conversations, memory, actions and provenance were
collapsed into one vague blob.

## Record groups

| Group          | Tables                                                | Purpose                                                |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Conversation   | `threads`, `messages`                                 | canonical raw interaction history                      |
| Work           | `projects`, `tasks`                                   | explicit project state that can be surfaced on demand  |
| Presence       | `activity_items`                                      | first-person progress, decisions, warnings and reviews |
| Memory         | `memory_items`, `memory_embeddings`                   | sourced, confidence-bearing personal knowledge         |
| Files          | `documents`, `document_chunks`, `document_embeddings` | local retrieval with hashes and provenance             |
| Agency         | `agent_runs`, `tool_invocations`, `approval_requests` | what was attempted and what authority it had           |
| Infrastructure | `outbox_events`, pg-boss tables                       | reliable background delivery and retries               |
| Accountability | `audit_events`                                        | append-only consequential-action history               |
| Configuration  | `system_settings`, `schema_migrations`                | durable settings and immutable schema history          |

## Rules

1. A message may lead to zero, one or several proposed memories. It is never itself silently promoted.
2. Embeddings are disposable indexes, not canonical data. They carry provider, model and dimensionality.
3. Tool arguments and results are structured JSON, but human-readable summaries live separately.
4. Projects exist independently from conversation threads. A project may have several conversations and jobs.
5. Audit events are appended; corrections are new events rather than edits to history.
6. Files are identified by source and content hash. A changed file becomes a new indexed version.
7. SQL migration files are immutable after application. Any later change receives a new numbered migration.
8. Assistant messages record `complete`, `cancelled` or `failed`; partial output remains evidence but is not
   admitted into later model context as a completed reply.
9. Archiving a conversation sets `threads.archived_at`. It removes the thread from the active history UI without
   deleting its messages.
10. Only `active` memory is eligible for model context. At most one active row may exist for a case-insensitive
    `(kind, subject)` pair; revisions supersede rather than overwrite the prior row and close its validity
    window.
11. Extracted memory retains provider/model metadata, an exact source message identifier and a short displayed
    rationale. The source message must be a completed owner message in the conversation being reviewed.

## Memory retrieval

`memory_items` is canonical; `memory_embeddings` is a disposable ranking index. Retrieval first filters on
`active` status and the configured sensitivity ceiling. PostgreSQL full-text candidates are always available.
When a configured embedding provider is healthy, eligible missing rows are indexed in bounded batches and a
pgvector cosine search contributes semantic candidates. The application fuses lexical rank, semantic
similarity, importance and confirmation recency and records a human-readable selection reason. Proposed,
rejected and superseded rows remain review history and are never returned by the context source.

An embedding failure never changes canonical memory or blocks chat: retrieval falls back to the full-text
result. The sensitivity ceiling is applied before text is offered to an embedding provider as well as before
search, so a remote embedding adapter cannot see claims that its context policy would exclude.

## Why vector dimensions are not fixed in the column type

Embedding models can produce different dimensions. Both embedding tables use unconstrained `vector` columns
and record the dimension explicitly. A similarity index should later be created for the chosen active model,
or in a model-specific partition. This prevents an early embedding choice from becoming a permanent schema
constraint.

## Backups

The Docker volume is persistence, not a backup. A later operations milestone adds scheduled `pg_dump` exports,
encryption, retention and restore drills. Database dumps, indexed personal files and `.env` never belong in Git.
