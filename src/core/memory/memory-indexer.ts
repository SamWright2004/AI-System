import type {
  MemoryEmbeddingGateway,
  MemoryIndexManager,
  MemoryIndexStatus,
  MemoryIndexSummary,
  MemoryItem,
  MemoryRetrievalRepository,
} from "./types.js";

const defaultBatchSize = 32;
const defaultIndexLimit = 256;

function embeddingText(memory: MemoryItem): string {
  return `${memory.kind}: ${memory.subject}\n${memory.content}`;
}

function validateBatch(inputCount: number, dimensions: number, vectors: number[][]): void {
  if (!Number.isInteger(dimensions) || dimensions < 1 || vectors.length !== inputCount) {
    throw new Error("The embedding provider returned an invalid batch shape.");
  }

  for (const vector of vectors) {
    if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("The embedding provider returned an invalid vector.");
    }
  }
}

export class MemoryIndexer implements MemoryIndexManager {
  public constructor(
    private readonly repository: MemoryRetrievalRepository,
    private readonly embeddings: MemoryEmbeddingGateway,
    private readonly maxSensitivity: number,
    private readonly batchSize = defaultBatchSize,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) {
      throw new Error("Memory embedding batch size must be between 1 and 256.");
    }
  }

  public async getStatus(): Promise<MemoryIndexStatus> {
    const coverage = await this.repository.getMemoryEmbeddingCoverage({
      provider: this.embeddings.provider,
      model: this.embeddings.model,
      maxSensitivity: this.maxSensitivity,
    });

    return {
      enabled: true,
      provider: this.embeddings.provider,
      model: this.embeddings.model,
      dimensions: coverage.dimensions,
      eligible: coverage.eligible,
      indexed: coverage.indexed,
      pending: Math.max(0, coverage.eligible - coverage.indexed),
    };
  }

  public async indexMemory(memory: MemoryItem, signal?: AbortSignal): Promise<boolean> {
    if (memory.status !== "active" || memory.sensitivity > this.maxSensitivity) return false;
    signal?.throwIfAborted();
    const batch = await this.embeddings.embed([embeddingText(memory)], signal);
    validateBatch(1, batch.dimensions, batch.vectors);
    const vector = batch.vectors[0];
    if (!vector) throw new Error("The embedding provider returned no vector.");
    await this.repository.upsertMemoryEmbeddings([
      {
        memoryId: memory.id,
        provider: batch.provider,
        model: batch.model,
        dimensions: batch.dimensions,
        vector,
      },
    ]);
    return true;
  }

  public async indexPending(
    input: {
      limit?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<MemoryIndexSummary> {
    const limit = input.limit ?? defaultIndexLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) {
      throw new Error("Memory index limit must be between 1 and 5000.");
    }

    const memories = await this.repository.listActiveMemoriesWithoutEmbedding({
      provider: this.embeddings.provider,
      model: this.embeddings.model,
      maxSensitivity: this.maxSensitivity,
      limit,
    });
    let created = 0;

    for (let offset = 0; offset < memories.length; offset += this.batchSize) {
      input.signal?.throwIfAborted();
      const slice = memories.slice(offset, offset + this.batchSize);
      const batch = await this.embeddings.embed(slice.map(embeddingText), input.signal);
      validateBatch(slice.length, batch.dimensions, batch.vectors);
      await this.repository.upsertMemoryEmbeddings(
        slice.map((memory, index) => {
          const vector = batch.vectors[index];
          if (!vector) throw new Error("The embedding provider returned an incomplete batch.");
          return {
            memoryId: memory.id,
            provider: batch.provider,
            model: batch.model,
            dimensions: batch.dimensions,
            vector,
          };
        }),
      );
      created += slice.length;
    }

    const status = await this.getStatus();
    return {
      ...status,
      created,
      skipped: Math.max(0, memories.length - created),
    };
  }
}
