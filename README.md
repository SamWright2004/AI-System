# Personal AI Foundation

A local-first starting point for a private, single-user AI collaborator. The resting interface is deliberately
quiet: a waiting artificial mind, one conversation, and a first-person account of background work. Projects,
files and detailed controls appear when they are relevant instead of permanently cluttering the home screen.

This is the foundation, not a fake finished assistant. It currently provides:

- a working React interface with streamed replies;
- a local Fastify service bound to `127.0.0.1`;
- PostgreSQL 18 with pgvector for conversations, memory, projects and provenance;
- a durable background worker using the same database rather than another infrastructure service;
- provider isolation, with local Ollama, safe mock mode and an optional OpenAI Responses API adapter;
- token-budgeted, paginated context assembly with labelled, trust-aware extension points;
- a private hot-reloaded personalisation profile that can name both sides and shape working style;
- persisted provider, token, timing and context-selection diagnostics on assistant messages;
- deterministic tool-risk and approval policy;
- audit, approval, run, outbox and activity records ready for later capabilities;
- tests, formatting, type checking, production builds and GitHub CI.

## Start on Windows

Install these first:

1. [Git for Windows](https://git-scm.com/download/win)
2. [Node.js 24 LTS](https://nodejs.org/en/download)
3. [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) using WSL 2
4. [VS Code](https://code.visualstudio.com/) or your preferred editor
5. pnpm 11: `npm install --global pnpm@11`

Open PowerShell in this folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\bootstrap.ps1
pnpm dev
```

Then open <http://127.0.0.1:5173>.

The application begins in `mock` mode. It can be fully started, tested and inspected without an API key or
paid model call.

## Use the local Ollama model

After [installing Ollama](https://ollama.com/download), pull the configured model:

```powershell
ollama pull qwen3.5:4b
```

Open `.env`, set `AI_PROVIDER=ollama`, and restart `pnpm dev`. Replies remain on the local provider path and
the adapter records Ollama's prompt, generation and timing telemetry when it is supplied.

## Make it yours

The bootstrap creates `config/personalisation/profile.local.json` from the committed example. That local file
is ignored by Git. Edit the owner and assistant display names, tone, response detail, initiative and pinned
instructions there. The model-side profile is re-read for every reply, so behaviour edits need no restart; a
page refresh updates the quiet header and resting greeting.

For an existing checkout that predates this feature, create it once in PowerShell:

```powershell
Copy-Item config/personalisation/profile.example.json config/personalisation/profile.local.json
```

Keep secrets out of the profile. It is intentionally eligible for model context.

Conversation history is selected by `CONTEXT_INPUT_TOKEN_BUDGET` and read backwards in small database pages.
The current user message is always preserved, older history is admitted as complete turns, and the resulting
selection diagnostics are stored with the reply. Future memory and project retrieval implement the same
`ContextSource` contract rather than modifying the chat pipeline.

## Optional: connect OpenAI

Open `.env` and change:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-project-key
```

Restart `pnpm dev`. The key remains server-side and `.env` is excluded from Git. The default model is
`gpt-5.6-terra`; model names are configuration, not hard-coded architectural dependencies.

## Everyday commands

| Command               | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `pnpm dev`            | Run the interface, local API and worker together |
| `pnpm test`           | Run unit tests                                   |
| `pnpm typecheck`      | Check TypeScript without emitting files          |
| `pnpm lint`           | Run static analysis                              |
| `pnpm format`         | Format the repository                            |
| `pnpm build`          | Produce the interface, API and worker builds     |
| `pnpm verify`         | Run every local quality gate used by CI          |
| `pnpm db:migrate`     | Apply new immutable SQL migrations               |
| `pnpm db:seed`        | Add safe, repeatable starter records             |
| `docker compose down` | Stop the database without deleting its volume    |

Do not run `docker compose down -v` casually: `-v` deletes the local database volume.

## Repository map

```text
config/prompts/          Versioned behaviour, separate from application code
config/personalisation/  Safe template for the Git-ignored owner profile
db/migrations/           Immutable database history
docs/                    Architecture, security and staged build plan
scripts/                 Repeatable setup and database operations
src/core/                Domain contracts, context assembly and deterministic policies
src/infrastructure/      Model, context-source, PostgreSQL and queue adapters
src/server/              Local HTTP and streaming boundary
src/ui/                  The personal interface
src/worker/              Durable background work
tests/                   Behavioural tests
```

Dependencies point inward. The core does not import Fastify, OpenAI, PostgreSQL or React. That rule is what
lets us replace a provider or split out a worker later without rewriting the system's identity and behaviour.

## Read next

- [The complete build guide](docs/ultimate-build-guide.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Security and autonomy](docs/security.md)
- [Roadmap](docs/roadmap.md)
- [Architecture decisions](docs/adr/0001-modular-monolith.md), including
  [budgeted context assembly](docs/adr/0004-budgeted-context-assembly.md)

## Current boundaries

The UI is private in product design, but this first build is not ready to be exposed to a network. It has no
remote authentication, connectors, computer control or autonomous external actions. Keep it on localhost.
Those omissions are deliberate: authority, memory quality and observability need to exist before capability.
