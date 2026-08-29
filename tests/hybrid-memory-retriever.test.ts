import { describe, expect, it } from "vitest";
import {
  HybridMemoryRetriever,
  rankMemoryCandidates,
} from "../src/core/memory/hybrid-memory-retriever.js";
import { MemoryIndexer } from "../src/core/memory/memory-indexer.js";
import type {
  MemoryEmbeddingBatch,
  MemoryEmbeddingGateway,
  MemoryEmbeddingRecord,
  MemoryItem,
  MemoryRetrievalRepository,
} from "../src/core/memory/types.js";

const now = "2026-08-29T12:00:00.000Z";

function memory(
  id: string,
  subject: string,
  content: string,
  sensitivity = 0,
  importance = 50,
): MemoryItem {
  return {
    id,
    kind: "project",
    subject,
    content,
    status: "active",
    confidence: 1,
    importance,
    sensitivity,
    rationale: "Confirmed in the test fixture.",
    source: { type: "owner", id: null, excerpt: null, threadId: null, threadTitle: null },
    supersedesId: null,
    validFrom: now,
    validUntil: null,
    lastConfirmedAt: now,
    extraction: { provider: null, model: null },
    createdAt: now,
    updatedAt: now,
  };
}

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftLength = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightLength = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return leftLength && rightLength ? dot / (leftLength * rightLength) : 0;
}

class RetrievalRepository implements MemoryRetrievalRepository {
  public readonly embeddings = new Map<string, MemoryEmbeddingRecord>();

  public constructor(
    public readonly items: MemoryItem[],
    private readonly lexicalIds: string[] = [],
  ) {}

  public async searchLexicalCandidates(input: { limit: number; maxSensitivity: number }) {
    return this.lexicalIds
      .map((id) => this.items.find((item) => item.id === id))
      .filter((item): item is MemoryItem =>
        Boolean(item && item.sensitivity <= input.maxSensitivity),
      )
      .slice(0, input.limit)
      .map((item) => ({ memory: item, lexicalScore: 0.7 }));
  }

  public async searchSemanticCandidates(input: {
    vector: number[];
    provider: string;
    model: string;
    dimensions: number;
    limit: number;
    maxSensitivity: number;
  }) {
    return this.items
      .filter((item) => item.sensitivity <= input.maxSensitivity)
      .map((item) => ({ item, record: this.embeddings.get(item.id) }))
      .filter((candidate): candidate is { item: MemoryItem; record: MemoryEmbeddingRecord } =>
        Boolean(
          candidate.record &&
          candidate.record.provider === input.provider &&
          candidate.record.model === input.model &&
          candidate.record.dimensions === input.dimensions,
        ),
      )
      .map(({ item, record }) => ({
        memory: item,
        semanticScore: cosine(record.vector, input.vector),
      }))
      .sort((left, right) => right.semanticScore - left.semanticScore)
      .slice(0, input.limit);
  }

  public async listActiveMemoriesWithoutEmbedding(input: {
    provider: string;
    model: string;
    maxSensitivity: number;
    limit: number;
  }) {
    return this.items
      .filter(
        (item) =>
          item.status === "active" &&
          item.sensitivity <= input.maxSensitivity &&
          !this.embeddings.has(item.id),
      )
      .slice(0, input.limit);
  }

  public async upsertMemoryEmbeddings(records: ReadonlyArray<MemoryEmbeddingRecord>) {
    for (const record of records) this.embeddings.set(record.memoryId, record);
  }

  public async getMemoryEmbeddingCoverage(input: {
    provider: string;
    model: string;
    maxSensitivity: number;
  }) {
    const eligible = this.items.filter(
      (item) => item.status === "active" && item.sensitivity <= input.maxSensitivity,
    );
    const indexed = eligible.filter((item) => {
      const record = this.embeddings.get(item.id);
      return record?.provider === input.provider && record.model === input.model;
    });
    return {
      eligible: eligible.length,
      indexed: indexed.length,
      dimensions: indexed[0] ? (this.embeddings.get(indexed[0].id)?.dimensions ?? null) : null,
    };
  }
}

class MeaningEmbeddingGateway implements MemoryEmbeddingGateway {
  public readonly provider = "test";
  public readonly model = "meaning-v1";
  public fail = false;

  public async embed(input: ReadonlyArray<string>): Promise<MemoryEmbeddingBatch> {
    if (this.fail) throw new Error("Embedding model is offline.");
    return {
      provider: this.provider,
      model: this.model,
      dimensions: 2,
      vectors: input.map((text) => (/film|emotion|tension|ksp/i.test(text) ? [1, 0] : [0, 1])),
    };
  }
}

describe("hybrid memory retrieval", () => {
  it("indexes approved memories and retrieves a meaning match without shared wording", async () => {
    const relevant = memory(
      "10000000-0000-4000-8000-000000000001",
      "KSP visual storytelling",
      "The short film should preserve emotion and tension without showing human faces.",
      0,
      80,
    );
    const unrelated = memory(
      "10000000-0000-4000-8000-000000000002",
      "Cooking",
      "Fried rice should use dry, cooled rice.",
    );
    const privateMemory = memory(
      "10000000-0000-4000-8000-000000000003",
      "Private fixture",
      "A sensitive film detail.",
      2,
      100,
    );
    const repository = new RetrievalRepository([relevant, unrelated, privateMemory]);
    const embeddings = new MeaningEmbeddingGateway();
    const indexer = new MemoryIndexer(repository, embeddings, 1, 8);
    const retriever = new HybridMemoryRetriever(repository, embeddings, indexer, {
      autoIndexLimit: 8,
      minimumSemanticScore: 0.4,
      now: () => new Date(now),
    });

    const result = await retriever.retrieve({
      query: "How do I keep the movie emotionally intense?",
      limit: 4,
      maxSensitivity: 1,
    });

    expect(result).toMatchObject({
      mode: "hybrid",
      diagnostics: { indexedBeforeSearch: 2, semanticCandidates: 2 },
    });
    expect(result.matches.map((match) => match.memory.id)).toEqual([relevant.id]);
    expect(result.matches[0]).toMatchObject({ reasons: expect.arrayContaining(["meaning match"]) });
    expect(repository.embeddings.has(privateMemory.id)).toBe(false);
  });

  it("falls back to lexical ranking without failing the conversation", async () => {
    const lexical = memory(
      "20000000-0000-4000-8000-000000000001",
      "Preferred units",
      "The owner prefers metric units.",
    );
    const repository = new RetrievalRepository([lexical], [lexical.id]);
    const embeddings = new MeaningEmbeddingGateway();
    embeddings.fail = true;
    const retriever = new HybridMemoryRetriever(
      repository,
      embeddings,
      new MemoryIndexer(repository, embeddings, 3),
      { now: () => new Date(now) },
    );

    const result = await retriever.retrieve({
      query: "Which units should I use?",
      limit: 4,
      maxSensitivity: 3,
    });

    expect(result.mode).toBe("lexical");
    expect(result.matches[0]?.memory.id).toBe(lexical.id);
    expect(result.diagnostics.fallbackReason).toBe("Embedding model is offline.");
  });

  it("uses deterministic importance and recency tie-breakers", () => {
    const first = memory("a", "A", "A", 0, 20);
    const important = memory("b", "B", "B", 0, 90);
    const ranked = rankMemoryCandidates(
      [
        { memory: first, lexical: 0.5, semantic: null },
        { memory: important, lexical: 0.5, semantic: null },
      ],
      2,
      new Date(now),
    );
    expect(ranked.map((match) => match.memory.id)).toEqual([important.id, first.id]);
  });
});
