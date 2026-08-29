import type {
  MemoryEmbeddingGateway,
  MemoryIndexManager,
  MemoryItem,
  MemoryRetrievalMatch,
  MemoryRetrievalRepository,
  MemoryRetrievalResult,
  MemoryRetriever,
} from "./types.js";

interface RankedInput {
  memory: MemoryItem;
  lexical: number;
  semantic: number | null;
}

export interface HybridMemoryRetrieverOptions {
  candidateLimit?: number;
  autoIndexLimit?: number;
  minimumSemanticScore?: number;
  now?: () => Date;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function recencyScore(memory: MemoryItem, now: Date): number {
  const anchor = memory.lastConfirmedAt ?? memory.updatedAt;
  const ageDays = Math.max(0, (now.getTime() - new Date(anchor).getTime()) / 86_400_000);
  return Math.exp(-ageDays / 365);
}

export function rankMemoryCandidates(
  candidates: ReadonlyArray<RankedInput>,
  limit: number,
  now = new Date(),
): MemoryRetrievalMatch[] {
  return candidates
    .map(({ memory, lexical, semantic }) => {
      const lexicalScore = clamp01(lexical);
      const semanticScore = semantic === null ? null : clamp01(semantic);
      const importance = memory.importance / 100;
      const recency = recencyScore(memory, now);
      const combined =
        semanticScore === null
          ? lexicalScore * 0.68 + importance * 0.22 + recency * 0.1
          : semanticScore * 0.5 + lexicalScore * 0.28 + importance * 0.17 + recency * 0.05;
      const reasons: string[] = [];
      if (lexicalScore >= 0.05) reasons.push("wording match");
      if (semanticScore !== null && semanticScore >= 0.45) reasons.push("meaning match");
      if (memory.importance >= 75) reasons.push("high importance");
      if (recency >= 0.85) reasons.push("recently confirmed");
      if (reasons.length === 0) reasons.push("best available match");

      return {
        memory,
        score: {
          lexical: roundScore(lexicalScore),
          semantic: semanticScore === null ? null : roundScore(semanticScore),
          importance: roundScore(importance),
          recency: roundScore(recency),
          combined: roundScore(combined),
        },
        reasons,
      };
    })
    .sort(
      (left, right) =>
        right.score.combined - left.score.combined ||
        right.memory.importance - left.memory.importance ||
        right.memory.updatedAt.localeCompare(left.memory.updatedAt) ||
        left.memory.id.localeCompare(right.memory.id),
    )
    .slice(0, limit);
}

function safeFallbackReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 240);
  return "Embedding retrieval was unavailable.";
}

export class HybridMemoryRetriever implements MemoryRetriever {
  private readonly candidateLimit: number;
  private readonly autoIndexLimit: number;
  private readonly minimumSemanticScore: number;
  private readonly now: () => Date;

  public constructor(
    private readonly repository: MemoryRetrievalRepository,
    private readonly embeddings: MemoryEmbeddingGateway | null,
    private readonly indexer: MemoryIndexManager | null,
    options: HybridMemoryRetrieverOptions = {},
  ) {
    this.candidateLimit = options.candidateLimit ?? 48;
    this.autoIndexLimit = options.autoIndexLimit ?? 32;
    this.minimumSemanticScore = options.minimumSemanticScore ?? 0.35;
    this.now = options.now ?? (() => new Date());
  }

  public async retrieve(input: {
    query: string;
    limit: number;
    maxSensitivity: number;
    signal?: AbortSignal;
  }): Promise<MemoryRetrievalResult> {
    const query = input.query.trim();
    const candidateLimit = Math.max(input.limit, this.candidateLimit);
    const lexical = await this.repository.searchLexicalCandidates({
      query,
      limit: candidateLimit,
      maxSensitivity: input.maxSensitivity,
    });
    const combined = new Map<string, RankedInput>();
    for (const candidate of lexical) {
      combined.set(candidate.memory.id, {
        memory: candidate.memory,
        lexical: candidate.lexicalScore,
        semantic: null,
      });
    }

    let semanticCount = 0;
    let indexedBeforeSearch = 0;
    let fallbackReason: string | null = null;
    let mode: MemoryRetrievalResult["mode"] = "lexical";

    if (this.embeddings && this.indexer && query) {
      try {
        if (this.autoIndexLimit > 0) {
          const indexed = await this.indexer.indexPending({
            limit: this.autoIndexLimit,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          indexedBeforeSearch = indexed.created;
        }
        input.signal?.throwIfAborted();
        const queryBatch = await this.embeddings.embed([query], input.signal);
        const vector = queryBatch.vectors[0];
        if (!vector || vector.length !== queryBatch.dimensions) {
          throw new Error("The embedding provider returned an invalid query vector.");
        }
        if (vector.every((value) => value === 0)) {
          throw new Error("The query did not contain embeddable terms.");
        }
        const semantic = await this.repository.searchSemanticCandidates({
          vector,
          provider: queryBatch.provider,
          model: queryBatch.model,
          dimensions: queryBatch.dimensions,
          limit: candidateLimit,
          maxSensitivity: input.maxSensitivity,
        });
        semanticCount = semantic.length;
        for (const candidate of semantic) {
          if (candidate.semanticScore < this.minimumSemanticScore) continue;
          const existing = combined.get(candidate.memory.id);
          combined.set(candidate.memory.id, {
            memory: candidate.memory,
            lexical: existing?.lexical ?? 0,
            semantic: candidate.semanticScore,
          });
        }
        mode = "hybrid";
      } catch (error) {
        if (input.signal?.aborted) throw error;
        fallbackReason = safeFallbackReason(error);
      }
    }

    return {
      query,
      mode,
      matches: rankMemoryCandidates([...combined.values()], input.limit, this.now()),
      diagnostics: {
        lexicalCandidates: lexical.length,
        semanticCandidates: semanticCount,
        indexedBeforeSearch,
        embeddingProvider: this.embeddings?.provider ?? null,
        embeddingModel: this.embeddings?.model ?? null,
        fallbackReason,
      },
    };
  }
}
