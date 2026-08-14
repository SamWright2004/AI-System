# ADR 0001: Begin as a local modular monolith

- Status: accepted
- Date: 2026-08-12

## Context

The product may eventually coordinate conversation, long-term memory, files, creative software, voice,
background work and external services. It is tempting to begin with microservices or an elaborate multi-agent
graph. At the current scale, those choices would make ordinary changes slower and failures harder to understand.

## Decision

Use one TypeScript repository with a React UI, Fastify server, application core, PostgreSQL database and a
separate worker process. Enforce ports-and-adapters boundaries in code. Use a transactional outbox and durable
job queue as extraction seams.

## Consequences

- Setup, debugging and atomic changes remain manageable for one developer.
- One language covers UI, API, the current agent loop and background jobs.
- PostgreSQL is the only mandatory stateful service.
- Python and GPU-heavy tooling can be introduced as workers without becoming the system of record.
- Module boundaries require discipline and architectural tests; folders alone do not prevent coupling.
- A service may be extracted later only when deployment, load or ecosystem differences justify it.
