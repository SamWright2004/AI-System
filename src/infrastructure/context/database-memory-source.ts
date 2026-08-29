import type {
  MemoryRepository,
  MemoryRetrievalResult,
  MemoryRetriever,
} from "../../core/memory/types.js";
import type {
  ContextCandidate,
  ContextSource,
  ContextSourceInput,
} from "../../core/context/types.js";

export class DatabaseMemorySource implements ContextSource {
  public readonly id = "approved-memory";
  private readonly retriever: MemoryRetriever;

  public constructor(
    memories: MemoryRetriever | MemoryRepository,
    private readonly maxSensitivity: number,
  ) {
    this.retriever =
      "retrieve" in memories
        ? memories
        : {
            retrieve: async (input): Promise<MemoryRetrievalResult> => {
              const items = await memories.searchActiveMemories(input);
              return {
                query: input.query,
                mode: "lexical",
                matches: items.map((memory) => ({
                  memory,
                  score: {
                    lexical: 1,
                    semantic: null,
                    importance: memory.importance / 100,
                    recency: 0,
                    combined: 1,
                  },
                  reasons: ["wording match"],
                })),
                diagnostics: {
                  lexicalCandidates: items.length,
                  semanticCandidates: 0,
                  indexedBeforeSearch: 0,
                  embeddingProvider: null,
                  embeddingModel: null,
                  fallbackReason: null,
                },
              };
            },
          };
  }

  public async load(input: ContextSourceInput): Promise<ReadonlyArray<ContextCandidate>> {
    const result = await this.retriever.retrieve({
      query: input.currentMessage.content,
      limit: 16,
      maxSensitivity: this.maxSensitivity,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return result.matches.map(({ memory, score, reasons }) => ({
      id: "memory:" + memory.id,
      source: this.id,
      title: "Approved " + memory.kind + ": " + memory.subject,
      trust: "application",
      priority: 600 + Math.round(score.combined * 100),
      content: JSON.stringify({
        kind: memory.kind,
        subject: memory.subject,
        claim: memory.content,
        confidence: memory.confidence,
        confirmedAt: memory.lastConfirmedAt,
        source: {
          type: memory.source.type,
          id: memory.source.id,
          conversation: memory.source.threadTitle,
        },
        retrieval: {
          mode: result.mode,
          score: score.combined,
          reasons,
        },
      }),
    }));
  }
}
