# ADR 0002: Keep canonical state locally

- Status: accepted
- Date: 2026-08-12

## Decision

PostgreSQL owns canonical conversations, memories, projects, run history, approvals and audit records. Provider
conversation state is optional acceleration, never the sole copy. Model adapters receive assembled context and
return model events; they do not own personal state.

## Consequences

- Providers and model families can be changed without losing identity or history.
- Privacy, export, search and backup policy remain under application control.
- The application must implement context assembly and compaction deliberately.
- Requests to cloud models still transmit the selected context; local ownership does not make a cloud call
  offline or private by magic.
