import type { MemoryRepository } from "../../core/memory/types.js";
import type {
  ContextCandidate,
  ContextSource,
  ContextSourceInput,
} from "../../core/context/types.js";

export class DatabaseMemorySource implements ContextSource {
  public readonly id = "approved-memory";

  public constructor(
    private readonly memories: MemoryRepository,
    private readonly maxSensitivity: number,
  ) {}

  public async load(input: ContextSourceInput): Promise<ReadonlyArray<ContextCandidate>> {
    const memories = await this.memories.searchActiveMemories({
      query: input.currentMessage.content,
      limit: 16,
      maxSensitivity: this.maxSensitivity,
    });

    return memories.map((memory) => ({
      id: "memory:" + memory.id,
      source: this.id,
      title: "Approved " + memory.kind + ": " + memory.subject,
      trust: "application",
      priority: 600 + memory.importance,
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
      }),
    }));
  }
}
