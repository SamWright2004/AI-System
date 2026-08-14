# ADR 0003: Authority lives outside the model

- Status: accepted
- Date: 2026-08-12

## Decision

Every tool declares a risk class. A deterministic application policy decides whether a call is allowed, denied
or paused for approval. External commitments and destructive actions cannot be authorised by prompt text.

## Consequences

- Prompt injection and model mistakes meet a second, non-generative control layer.
- Background work can safely prepare drafts and internal analysis while consequential actions wait.
- Tool builders must provide accurate risk, target, reversibility and data-egress metadata.
- The audit trail can explain both executed and blocked actions.
