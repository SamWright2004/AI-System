import type { MemoryEmbeddingGateway } from "../../core/memory/types.js";
import type { AppConfig } from "../../shared/config.js";
import { MockMemoryEmbeddingGateway } from "./mock-memory-embedding.js";
import { OllamaMemoryEmbeddingGateway } from "./ollama-memory-embedding.js";
import { OpenAiMemoryEmbeddingGateway } from "./openai-memory-embedding.js";

export function createMemoryEmbeddingGateway(config: AppConfig): MemoryEmbeddingGateway | null {
  if (config.memoryEmbeddingProvider === "disabled") return null;
  if (config.memoryEmbeddingProvider === "mock") return new MockMemoryEmbeddingGateway();
  if (config.memoryEmbeddingProvider === "ollama") {
    if (!config.ollamaEmbeddingModel) {
      throw new Error("OLLAMA_EMBEDDING_MODEL is required for Ollama memory embeddings.");
    }
    return new OllamaMemoryEmbeddingGateway(config.ollamaBaseUrl, config.ollamaEmbeddingModel);
  }
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI memory embeddings.");
  }
  return new OpenAiMemoryEmbeddingGateway(
    config.openAiApiKey,
    config.models.embedding,
    config.openAiEmbeddingDimensions,
  );
}
