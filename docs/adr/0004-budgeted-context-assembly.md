# ADR 0004: Assemble context behind explicit, budgeted sources

- Status: accepted
- Date: 2026-08-15

## Decision

Build every model request in the application core through a provider-neutral `ContextAssembler`. The current
user message is mandatory. Supplemental sources are prioritised, labelled with provenance and trust, and
admitted before cursor-paged conversation history. Older history is included only as complete turns while the
estimated input-token budget allows it.

The first supplemental source is an owner-controlled local personalisation file. Approved memory, active
project state, retrieved documents and tool results must implement the same `ContextSource` contract later.
Provider adapters receive the selected canonical messages and structured blocks; they do not retrieve or own
personal state.

## Consequences

- Conversation growth no longer creates an unbounded provider request or depends on an arbitrary message cap.
- Context selection can evolve independently of Ollama, OpenAI or a future model provider.
- Raw local history remains intact even when older turns are omitted from one model request.
- Every supplemental block carries an owner, application or external trust label.
- Selection diagnostics are persisted so truncation and retrieval quality can be evaluated.
- The current heuristic estimator is intentionally replaceable with provider-specific tokenisers.
- A malformed local profile fails visibly instead of silently changing or discarding owner instructions.
