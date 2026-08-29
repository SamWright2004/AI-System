# Honest-memory evaluation v2

F2 now has two separate quality measurements. They must remain separate because retrieval can select the right
claim while the answer uses it badly, and a polished answer can conceal that retrieval admitted the wrong
claim.

## Retrieval quality

`HybridMemoryRetriever` evaluates only approved rows below the configured sensitivity ceiling. Candidate
selection combines:

1. PostgreSQL full-text rank;
2. optional cosine similarity from the configured embedding model;
3. owner-assigned importance;
4. confirmation recency.

`Test recall` in the Memory drawer exposes the mode, selected claims, combined scores and reasons. The unit set
also verifies meaning-only matches, deterministic tie-breaking, sensitivity-before-indexing and lexical
fallback when the embedding gateway fails.

Hard gates from [v1](memory-v1.md) still apply. In particular, embeddings never make a proposed, rejected or
superseded row eligible, and vectors remain disposable indexes rather than evidence.

## Answer improvement

Run:

```bash
pnpm eval:memory
```

The harness reads `config/evaluations/memory-answer-v1.json`. For each case it generates an ordinary answer and
an answer with one approved-memory block, then asks a structured judge to score relevance, groundedness,
usefulness and overall quality. Every report records the assistant provider/model and judge provider/model.

Ollama uses the configured memory model as judge. OpenAI uses the configured fast model and a schema-validated
structured response. Mock mode uses deterministic expected-claim and forbidden-claim checks; this validates the
harness but is not a production quality baseline.

## Passing a provider baseline

A provider baseline is reviewable evidence, not a constant baked into CI. Record it after a model or prompt
change and compare like with like. The target is:

- every hard trust gate passes;
- no forbidden claim is introduced by memory;
- correct-memory-use rate is 100% on the small initial set;
- average enriched-answer improvement is positive;
- regressions are inspected per case rather than hidden by an average.

The set is deliberately small and versioned. Add cases that reflect actual failures before increasing its size
for appearance's sake.
