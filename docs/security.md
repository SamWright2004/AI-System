# Security and autonomy

This system is intended to become unusually capable and unusually personal. Treat those as reasons for a
stricter authority model, not excuses to waive one.

## Current threat model

Protect against:

- a compromised or hallucinating model proposing a harmful tool call;
- prompt injection inside web pages, email, documents or retrieved files;
- secrets leaking into the browser, logs, Git history or model context;
- another website reaching a carelessly exposed localhost API;
- silent corruption of personal memory;
- unattended background work exceeding its mandate;
- dependency or connector compromise;
- loss of the local database or machine.

## Authority classes

| Risk               | Examples                                           | Default policy                                      |
| ------------------ | -------------------------------------------------- | --------------------------------------------------- |
| `read`             | search indexed notes, inspect project metadata     | allow and audit where sensitive                     |
| `draft`            | draft an email, prepare a file patch, plan an edit | allow; label clearly as a draft                     |
| `write_reversible` | add a calendar draft, move a recoverable file      | scoped approval required unless a live grant exists |
| `external_commit`  | send, publish, purchase, submit, message           | explicit approval every time                        |
| `destructive`      | permanent delete, overwrite, credential change     | explicit approval; deny while unattended            |

The model supplies a proposal. `evaluateToolRisk` and later connector-specific policy supply authority. Model
text can never grant itself more permission.

## Approval quality

An approval card must state:

- the exact action;
- the exact target or recipient;
- material consequences;
- whether it is reversible;
- the data that will leave the machine;
- the expiry and scope of any reusable permission.

Avoid empty confirmation such as “Allow tool?” A meaningful decision requires enough detail to catch the
model choosing the wrong person, file or account.

## Secrets

- Keep provider and connector credentials in `.env` during local development only.
- Keep secrets out of `profile.local.json`; it is private and Git-ignored, but its selected contents are sent
  to the active model provider as owner-trusted context.
- Never expose API keys to Vite or any variable prefixed for client bundling.
- Never commit `.env`, database dumps, logs containing prompts or OAuth tokens.
- Move secrets to the operating-system credential vault before adding real connectors.
- Use separate provider projects/keys for development and any later always-on instance.
- Rotate a secret immediately if it appears in Git history; deleting the line is not sufficient.

## Network posture

The API and database bind to `127.0.0.1`. Do not change them to `0.0.0.0`, forward the ports on a router, or
publish the Docker database. Remote access comes later with real authentication, TLS, session expiry, CSRF
protection, rate limits and an authenticated tunnel. “Only I know the URL” is not authentication.

## Prompt injection

Retrieved content is untrusted data even if it looks like an instruction. Tools should receive structured,
validated arguments. Connectors should constrain resources at the application layer. High-risk operations must
display the resolved target to the user after tool planning and before execution.

## Memory integrity

Memory extraction is an explicit owner action. The extraction model can create only schema-validated proposals,
and each proposal must point to a completed owner message in the selected conversation. Proposed facts are
separated from active memory, retain their source and confidence, and can be edited, rejected or superseded.
Only an application transition triggered by the owner can activate one.

The context source queries active rows only and enforces a configurable sensitivity ceiling before retrieval.
OpenAI defaults to levels 0-1; local and mock providers default to 0-3. Sensitivity is not yet a complete privacy
policy: do not store secrets as memory, and review provider choice before raising a remote-provider ceiling.
Forgetting a derived memory does not delete its source conversation, so the evidence and the user's chat-history
controls remain independent.

## Dependency policy

pnpm 11 blocks dependency install scripts unless they are explicitly allowed. This repository permits only
`esbuild`, which is required by the build toolchain. CI uses the lockfile. Dependabot proposes updates, but
updates still need review and `pnpm verify` before merging.
