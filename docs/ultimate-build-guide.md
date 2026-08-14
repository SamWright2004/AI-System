# Building the personal AI system properly

## 1. What we are actually building

The target is not a reskinned ChatGPT window. It is a private operating layer for one person: conversational
when conversation is enough, able to reveal project detail when asked, capable of doing bounded background
work, and honest about what it changed and what still needs review.

The long-term system has six distinct responsibilities:

1. **Presence** — the calm home screen, conversation and eventually voice.
2. **State** — conversations, projects, tasks, files and durable personal memory.
3. **Reasoning** — cloud or local models chosen per task rather than one permanent model.
4. **Capability** — tools for files, research, creative software and external services.
5. **Agency** — schedules, background jobs, retries and resumable runs.
6. **Authority** — permissions, approvals, audit, privacy and cost limits.

Most hobby assistants muddle all six into a prompt and a Python script. That is quick for a demo and terrible
for a system expected to remember years of work or act on your behalf. This repository separates them now.

No architecture can promise that a decade-long project will never need substantial changes. “Doing it right”
means preserving the expensive things—data, behaviour contracts, provenance and authority—while keeping the
replaceable things—models, frameworks and interfaces—replaceable.

## 2. Decisions already made

These are foundation decisions. Change one through a written architecture decision rather than an impulsive
rewrite.

| Decision           | Choice                                  | Why                                                                   |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------- |
| Product            | single-user personal collaborator       | no profiles, teams, generic onboarding or commercial filler           |
| Home               | quiet artificial mind plus one composer | detailed project UI appears only when relevant                        |
| Status             | first-person activity rail              | tells you what I did, what changed and what needs review              |
| Initial runtime    | local modular monolith                  | easy to run and debug, with extraction seams                          |
| Main language      | TypeScript                              | one language for UI, API, agent integration and jobs                  |
| UI                 | React + Vite                            | fast local iteration; later wrappable in Tauri                        |
| Server             | Fastify                                 | small, typed and suitable for streaming                               |
| Canonical state    | PostgreSQL                              | transactions, full-text data, audit and mature backups                |
| Semantic retrieval | pgvector inside PostgreSQL              | no second database until scale proves a need                          |
| Background work    | pg-boss                                 | durable PostgreSQL queue without adding Redis                         |
| Cloud model API    | OpenAI Responses API adapter            | current state/tool/streaming primitive, isolated behind an interface  |
| Offline path       | later local-model adapter               | privacy and resilience without lowering the first build's reliability |
| Tool authority     | deterministic risk policy               | a model may propose an action but cannot authorise itself             |
| Remote access      | none at first                           | localhost is not exposed until authentication is real                 |

Python is not banned. It becomes a tool-worker language when Blender, ComfyUI, local ML or media processing
benefits from its ecosystem. It is not the canonical application core on day one because two languages would
double routine setup and debugging before giving us anything useful.

## 3. Install only what the foundation needs

### Required now

| Software       | Install                                                                             | Purpose                                                 |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Git            | [Git for Windows](https://git-scm.com/download/win)                                 | history, rollback, branches and GitHub                  |
| Node.js        | [Node.js 24 LTS](https://nodejs.org/en/download)                                    | application runtime                                     |
| pnpm           | `npm install --global pnpm@11`                                                      | locked, efficient dependencies and safer install policy |
| Docker Desktop | [Windows installer](https://docs.docker.com/desktop/setup/install/windows-install/) | reproducible PostgreSQL/pgvector                        |
| VS Code        | [download](https://code.visualstudio.com/)                                          | practical editor and terminal                           |

In Docker Desktop, use the WSL 2 backend. Restart the terminal after installing Git or Node so PowerShell sees
the new commands.

Useful checks:

```powershell
git --version
node --version
pnpm --version
docker --version
docker compose version
```

Node should report `v24.x`. pnpm should report `11.x`.

### Useful later, not required now

- GitHub Desktop if you prefer visual commits and diffs.
- GitHub CLI (`gh`) for creating repositories and pull requests from the terminal.
- DBeaver for inspecting PostgreSQL once you want a visual database client.
- Ollama when we build the local-provider adapter.
- Python 3.13/`uv` when the first Python creative-tool worker is approved.
- Rust and Tauri only when the web application is ready to become a desktop executable.

Do not install Kubernetes, Redis, a standalone vector database, LangChain, a graph database, Electron, several
local model launchers and three agent frameworks “for later.” Unused infrastructure decays and makes every
problem harder to locate.

## 4. Bootstrap the repository

Unzip or clone the repository into a stable development folder, for example:

```text
C:\Development\personal-ai
```

Avoid placing the live repository in OneDrive. Source control already handles source history, while database
volumes and `node_modules` behave badly when a sync client tries to copy them during writes.

Open PowerShell in the repository:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\bootstrap.ps1
```

The script performs repeatable, inspectable work:

1. checks Git, Node, pnpm and Docker;
2. creates `.env` without overwriting an existing one;
3. generates a random local application secret;
4. installs locked dependencies;
5. starts PostgreSQL/pgvector on `127.0.0.1:5434`;
6. waits for database health;
7. applies immutable migrations;
8. inserts idempotent foundation activity records.

Then run:

```powershell
pnpm dev
```

Open <http://127.0.0.1:5173>. You should see the waiting mind and three activity records. Send a message. Mock
mode should stream a reply and both messages should still be present after a refresh.

If setup fails, diagnose the layer shown in the error rather than repeatedly reinstalling everything:

```powershell
docker compose ps
docker compose logs postgres
pnpm typecheck
pnpm dev:api
```

Common causes are Docker Desktop not running, port `5434` already occupied, an older Node version earlier in
`PATH`, or a partial `.env` edited by hand.

## 5. Yes, make a GitHub repository—private

Git is non-negotiable for a project this large. GitHub is valuable for off-machine source backup, CI, issues
and pull requests. It must not become a backup for personal data.

Run the application once and make sure `pnpm verify` passes. Then:

```powershell
git init -b main
git add .
git status
git commit -m "chore: establish personal AI foundation"
```

Read `git status` before committing. It must not include `.env`, a database dump, logs, `node_modules`, `data`
or `backups`.

Create a **private** empty repository on GitHub called something neutral such as `personal-ai`. Do not ask
GitHub to add a README or `.gitignore` because those already exist. Then use the commands GitHub provides:

```powershell
git remote add origin https://github.com/YOUR-NAME/personal-ai.git
git push -u origin main
```

With GitHub CLI, the equivalent is:

```powershell
gh repo create personal-ai --private --source=. --remote=origin --push
```

Use short-lived feature branches:

```powershell
git switch -c feature/memory-proposals
# work, verify, commit
git push -u origin feature/memory-proposals
```

Even as the only developer, pull requests are useful for major changes because the diff forces a pause before
altering memory, permissions or migrations. Avoid a complex GitFlow scheme. `main` plus focused branches is
enough.

## 6. Know what each running process does

`pnpm dev` starts three processes:

| Process     | Port/state            | Responsibility                                    |
| ----------- | --------------------- | ------------------------------------------------- |
| Vite UI     | `127.0.0.1:5173`      | renders the home screen and streams server events |
| Fastify API | `127.0.0.1:4310`      | owns secrets, domain services and model calls     |
| Worker      | pg-boss in PostgreSQL | durable unattended and scheduled work             |

Docker runs PostgreSQL with pgvector on host port `5434`. The database volume survives `docker compose down`.
The browser talks to `/api`; Vite proxies that to Fastify during development. No provider key enters browser
JavaScript.

The source dependency direction is:

```text
UI / server / worker -> application core interfaces <- infrastructure adapters
```

The core may define `ConversationRepository`. PostgreSQL implements it. The core must never import `pg`.
The core may define `AssistantGateway`. OpenAI and a later Ollama adapter implement it. The core must never
refer to a provider-specific response type.

If a new feature seems to require importing OpenAI from project or memory logic, stop and add a narrower port.
That small discipline is the practical answer to “how do I avoid rewriting the whole thing?”

## 7. Connect the first real model carefully

API use is separate from the ChatGPT application. Create a project-scoped API key and set a spending limit in
the provider dashboard. Put the key only in `.env`:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=sk-project-...
```

Restart all dev processes. The first default route is:

- GPT-5.6 Terra for normal conversation and planning;
- GPT-5.6 Sol only for work where better judgement is worth the extra cost;
- GPT-5.6 Luna later for bounded extraction, classification and triage;
- `text-embedding-3-small` later for initial semantic indexes.

Do not send every task to the most expensive model. Do not send personal archive content to a cloud model merely
because it fits in a large context window. Context assembly should select the smallest relevant evidence set.

The current adapter calls the Responses API with `store: false` and streams typed output events. The local
database remains canonical. This does not mean the model call is offline: selected prompt content still leaves
the computer. A later local adapter is required for material that should not leave the machine at all.

Before moving beyond initial testing, add usage capture to `messages`/`agent_runs` and expose a quiet monthly
cost view. Costs should be observable and budgeted, not discovered on a bill.

## 8. Build features as vertical slices

Do not spend months constructing abstract “AI infrastructure” with no user-visible proof. Each milestone should
cross the whole stack in a small, testable slice:

```text
database migration -> repository -> core service -> route/job -> interface -> tests -> activity/audit
```

For example, the first memory slice should do exactly this:

1. after a completed exchange, enqueue `memory.extract-proposals`;
2. use structured output to return zero or more candidate memories;
3. validate candidates with Zod;
4. store them as `proposed` with message source IDs;
5. display one restrained review card;
6. allow approve, edit or reject;
7. retrieve only `active` memory in later context;
8. test jokes, quotes, fiction, uncertainty and contradictions.

That slice proves useful memory and its safety loop. A giant autonomous-memory framework would merely conceal
which part is wrong.

Every pull request should answer:

- What user-visible ability now exists?
- Which module owns the rule?
- What permanent data is created?
- What happens if the process dies halfway through?
- Which actions require approval?
- What evidence will tell us it works?
- How can the change be rolled back without deleting personal history?

## 9. Make memory defensible

Use three layers of context:

### Working context

Recent messages, current task state and temporary assumptions. It may expire after the run or thread.

### Episodic records

What happened: conversations, completed jobs, decisions, file versions and project checkpoints. These are
timestamped evidence, not necessarily durable beliefs.

### Semantic memory

Stable facts, preferences, relationships, routines and long-lived project truths. Each item needs source,
confidence, status and revision history.

Retrieval should combine:

1. deterministic scope filters (current project, active status, sensitivity permission);
2. recency/importance rules;
3. PostgreSQL full-text search for exact language;
4. vector similarity for meaning;
5. a small reranking step when the candidate set is ambiguous.

Vector search alone is not memory. A semantically similar old preference may be factually obsolete. Filters and
supersession matter as much as embeddings.

Make memory inspectable in plain language:

> I think X because you said Y in conversation Z on this date. Confidence: medium. Last confirmed: date.

Support correction and forgetting from the beginning. Deleting an embedding while retaining the canonical
memory is not forgetting. Conversely, rebuilding embeddings should never lose the memory itself.

## 10. Treat tools as typed capabilities, not prompt tricks

Every tool should declare:

- a stable name and version;
- Zod input and output schemas;
- risk class;
- required permissions and credential scope;
- timeout and resource limits;
- idempotency behaviour;
- whether it can run unattended;
- a human preview and audit summary;
- data-egress destinations.

Start with low-risk local tools:

1. search a permissioned workspace;
2. read a selected text file;
3. create a draft patch in a temporary workspace;
4. show a diff;
5. apply the approved patch;
6. undo the patch.

Do not begin with general unrestricted shell access. A narrowly designed filesystem tool is easier to secure,
test and explain. When shell execution eventually exists, run it inside a constrained workspace with explicit
timeouts, command logging and no inherited secrets by default.

External connectors come after target resolution and approvals. “Email Dannie” is not enough authority until
the application resolves the exact account and displays it. Content retrieved from an email or webpage is
untrusted and cannot alter the tool policy.

## 11. Background work must survive interruption

A real assistant cannot rely on an in-memory `setTimeout`. The computer restarts, networks fail, APIs rate-limit
and users change their minds.

Use the worker and queue for:

- memory proposals after conversations;
- file indexing after a content-hash change;
- project summaries after meaningful milestones;
- scheduled briefings and reminders;
- long model runs;
- media rendering and Blender/ComfyUI operations;
- retries and cleanup.

Each handler should be idempotent: processing the same job twice must not send twice, create duplicate memory
or corrupt a file. Use a stable idempotency key for external operations. Persist run state before and after each
irreversible boundary.

Background autonomy also needs budgets:

- maximum concurrent runs;
- per-day token or cash allowance;
- quiet hours;
- per-tool limits;
- maximum retry count;
- stop and review after repeated uncertainty;
- a global pause switch.

The activity rail should not become a log dump. Collapse routine successes, elevate failures and decisions, and
write as a collaborator: “I updated the shot list and left two timing choices for you,” not “Job 492 succeeded.”

## 12. Add projects without turning home into a dashboard

Projects are domain objects, not permanent navigation furniture. A project ties together goals, tasks,
conversations, decisions, files and runs. The chat can invoke `open_project`, after which the UI renders the
relevant workspace in context.

Use the KSP film as the first serious fixture because it exercises the architecture naturally:

- screenplay and story decisions;
- Blender sets and shots;
- image/video assets;
- weekly next actions;
- long gaps between sessions;
- creative judgement that should not be reduced to checkboxes.

A useful project checkpoint should answer:

- What are we trying to make?
- What changed since the last checkpoint?
- Which decisions are settled and why?
- What is blocked?
- Which source files are current?
- What is the next realistic action?

Do not make the model rediscover these by rereading an entire chat archive every time.

## 13. Integrate local creative tools as workers

When the first creative integration begins, add a Python tool-runner with a versioned JSON protocol. Keep it
outside canonical state ownership.

For Blender:

1. index scene metadata read-only;
2. inspect objects, collections, cameras and render settings;
3. create a plan and diff-like summary;
4. operate on a duplicate `.blend` file;
5. render a low-resolution preview;
6. request review;
7. only then allow an approved update to the working file.

For ComfyUI:

- submit a workflow by content hash;
- record model/checkpoint, seed, prompt and workflow version;
- save outputs inside the relevant project workspace;
- link derived assets to their inputs;
- show previews without committing every experiment to Git.

Generated media belongs in project storage with provenance. Large binary outputs should not enter ordinary Git
history. Use Git LFS only for a small, intentional set of source assets that genuinely need version control.

## 14. Add voice after text, memory and approvals work

Voice changes transport, interruption and latency; it should not create a second assistant. Start with
push-to-talk and a chained path:

```text
speech-to-text -> existing agent core -> approval/tool loop -> text-to-speech
```

This keeps transcripts, debugging and approvals visible. Test realtime speech-to-speech later for fluid casual
conversation. A consequential voice action still pauses and shows the exact approval card. Never rely on a
casual “yeah” heard by a microphone as authority to send, buy or delete.

## 15. Testing needs an evaluation set, not just code coverage

Unit and integration tests verify deterministic code. AI behaviour needs repeatable scenarios.

Create a private evaluation set containing examples such as:

- relevant memory retrieved correctly;
- irrelevant memory omitted;
- a joke not stored as biography;
- changed preference superseding an old one;
- contradictory evidence surfaced;
- quoted screenplay dialogue not treated as the user's belief;
- project resumption after a long gap;
- hostile document instruction ignored;
- wrong recipient requiring clarification;
- external action pausing for approval;
- background retry not duplicating a side effect;
- answer quality across Terra, Sol, Luna and a local model.

Store expected properties rather than one exact ideal paragraph. Score factual grounding, relevant recall,
unwanted recall, tool selection, permission compliance, cost and latency. Run the set before changing prompts,
models, retrieval or memory extraction.

## 16. Backups and recovery are part of the product

Once real conversations or project state enter the database, add:

1. nightly `pg_dump` to a local backup directory;
2. client-side encryption before any cloud copy;
3. retention such as seven daily, four weekly and twelve monthly snapshots;
4. a second physical or trusted encrypted location;
5. quarterly restore tests into a clean database;
6. export of prompts, settings and approved memory in readable JSON/Markdown.

Git protects source code. Docker volumes persist data across container restarts. Neither is an adequate backup
of the personal archive on the same physical drive.

## 17. Rules that prevent the future rewrite

Keep these visible in code review:

1. Canonical data belongs to the application, not a provider thread.
2. Models and tools sit behind narrow interfaces.
3. Migrations are additive and immutable after use.
4. Prompts are versioned and evaluated like code.
5. Every memory has provenance and lifecycle.
6. Every consequential action has non-model authority and audit.
7. Every background handler is retry-safe.
8. UI components display domain state; they do not invent it.
9. Build one agent loop until evidence justifies specialist handoffs.
10. Extract services only for measured deployment or ecosystem reasons.
11. Prefer exports and open formats over provider-only storage.
12. Never confuse local-first with cloud-free; label every data boundary honestly.

## 18. The exact next development sequence

Do these in order after the foundation runs:

### Session 1: establish ownership

- Run the bootstrap and mock conversation.
- Run `pnpm verify`.
- Create the private GitHub repository and first commit.
- Read the three ADRs and change any decision you genuinely reject now.
- Make a database backup manually once, even though it contains only test data.

### Session 2: real conversation

- Create a low-limit OpenAI project key.
- switch `.env` to OpenAI;
- test streaming, cancellation, restart persistence and provider failure;
- add token/cost capture;
- write ten conversation evaluation prompts.

### Session 3: context assembly

- replace the fixed 60-message context with a `ContextBuilder` interface;
- include the current thread, current project checkpoint and active memories in separate labelled blocks;
- add token budgets and truncation tests;
- preserve the raw local history regardless of what is sent.

### Sessions 4–6: memory proposals

- implement extraction as a background job;
- store only `proposed` memory;
- build the review UI and correction flow;
- add hybrid retrieval for approved memories;
- run the false-memory evaluation set before enabling automatic proposals by default.

### Sessions 7–9: the first project

- model project checkpoints and decisions;
- import the KSP film's selected source documents into a permissioned workspace;
- surface its workspace only after a conversational request;
- generate a grounded “where we are” and one next step;
- audit which files and memories supported the answer.

At that point the system will be genuinely personal and useful. Only then begin broader tools and unattended
work. The order is slower than a flashy weekend demo and much faster than rebuilding a dangerous, opaque one.

## 19. Reference sources for the current stack

- [OpenAI Responses conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI tools](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI models](https://developers.openai.com/api/docs/models)
- [Node.js release policy](https://nodejs.org/en/about/previous-releases)
- [Docker Desktop with WSL 2](https://docs.docker.com/desktop/features/wsl/)
- [pnpm installation](https://pnpm.io/installation)
- [pgvector](https://github.com/pgvector/pgvector)
- [pg-boss](https://github.com/timgit/pg-boss)
