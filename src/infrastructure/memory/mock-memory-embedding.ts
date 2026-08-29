import type { MemoryEmbeddingBatch, MemoryEmbeddingGateway } from "../../core/memory/types.js";

const dimensions = 96;

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function embedText(input: string): number[] {
  const vector = Array.from<number>({ length: dimensions }).fill(0);
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const term of terms) {
    const index = hash(term) % dimensions;
    const sign = hash(term + ":sign") % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export class MockMemoryEmbeddingGateway implements MemoryEmbeddingGateway {
  public readonly provider = "mock";
  public readonly model = "feature-hash-v1";

  public async embed(input: ReadonlyArray<string>): Promise<MemoryEmbeddingBatch> {
    return {
      provider: this.provider,
      model: this.model,
      dimensions,
      vectors: input.map(embedText),
    };
  }
}
