# Roadmap

This is ordered by dependency, not spectacle. Voice, computer control and multiple specialist agents look more
impressive than memory provenance or audit records, but they are much less useful if the underlying system is
unreliable.

## F0 — Foundation

Status: included in this repository.

- local UI, API, database and worker;
- mock and OpenAI provider boundary;
- streamed conversation persistence;
- project, memory, file, run, approval, audit and outbox schema;
- tool-risk policy;
- setup scripts, CI and architecture records.

Exit criteria: a clean checkout can be bootstrapped, `pnpm verify` passes, and a mock conversation survives a
restart.

## F1 — Reliable conversation

- connect the OpenAI Responses API;
- add model usage and cost records;
- implement context budgeting rather than a fixed last-60-message window;
- add retry/cancellation behaviour and useful provider errors;
- generate thread titles without cluttering the home view;
- export a conversation as Markdown/JSON;
- add API integration tests against a disposable PostgreSQL instance.

Exit criteria: twenty representative conversations work without duplicated messages, lost partial replies or
unbounded context growth.

## F2 — Honest memory

- extract proposed memories with a cheap structured model pass;
- classify facts, preferences, relationships, decisions, routines and project state;
- display source, confidence and “why I think this”;
- approve, edit, reject, forget and supersede memories;
- add hybrid retrieval: deterministic filters, full-text search and embeddings;
- build a regression set for false memories and incorrect retrieval.

Exit criteria: memory improves answers on a hand-built evaluation set and never silently promotes an unreviewed
claim into durable personal truth.

## F3 — Project workspaces on demand

- create and open projects conversationally;
- render project state only when requested or relevant;
- connect tasks, decisions, files, conversations and background runs;
- add KSP film as the first real project fixture;
- create review cards for changed plans, assets and unanswered questions;
- add checkpoints and project summaries rather than replaying entire histories.

Exit criteria: the assistant can resume a project after a week, explain what changed, and identify one sensible
next action with evidence.

## F4 — Tool platform and approvals

- versioned tool registry with Zod argument/result schemas;
- isolated tool runner and time/resource limits;
- approval cards with resolved targets and consequences;
- scoped grants with expiry and revocation;
- filesystem read, search and draft-patch tools first;
- connector credentials in the OS keychain;
- prompt-injection tests using hostile documents and webpages.

Exit criteria: every external or destructive action is impossible without the correct non-model authority, and
every executed action is reconstructable from the audit log.

## F5 — Genuine background work

- transactional outbox dispatcher;
- schedules and conditional triggers;
- idempotency keys, retries and dead-letter review;
- quiet hours, rate/cost budgets and concurrency limits;
- useful first-person activity summaries;
- pause, cancel, resume and inspect runs;
- back up and restore PostgreSQL automatically.

Exit criteria: unplugging the network or stopping the process mid-job does not duplicate an external action or
lose the run's state.

## F6 — Files and creative tools

- permissioned workspace roots;
- content hashing, chunking and re-indexing;
- image and video metadata, not just text embeddings;
- Python tool-runner protocol;
- Blender integration operating on duplicated/test files first;
- ComfyUI job adapter with generated-asset provenance;
- render and media review surfaces in project workspaces.

Exit criteria: the KSP project can ask for a scene or asset status, run a safe draft operation, and show exactly
which files and versions produced the result.

## F7 — Voice and presence

- add push-to-talk before always-listening audio;
- compare realtime speech-to-speech with a chained transcript/reasoning/voice path;
- preserve text transcripts and approval pauses;
- support interruption, cancellation and device selection;
- keep the same memory, tool and identity core as text.

Exit criteria: voice feels like another entrance to the same collaborator, not a separate forgetful assistant.

## F8 — Desktop and carefully authenticated remote access

- wrap the web UI in Tauri;
- store secrets in Windows Credential Manager;
- auto-start the local service and worker;
- signed local sessions and CSRF protection;
- encrypted authenticated tunnel for phone access;
- device revocation and a clear remote kill switch.

Exit criteria: no raw API or database port is exposed, and losing a remote device does not expose the personal
archive.

## F9 — Adaptation and specialist reasoning

- prompt/model evaluation harness;
- task-based model routing and cost budgets;
- specialist agents only where ownership is genuinely clearer;
- trace handoffs and prevent recursive delegation;
- learn presentation preferences from explicit feedback;
- optional local model for sensitive/offline tasks;
- periodic memory and permission review.

Exit criteria: specialization measurably improves defined tasks. “More agents” is never treated as a feature in
itself.
