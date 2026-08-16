import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryExtractionGateway } from "../../core/memory/types.js";
import type { AppConfig } from "../../shared/config.js";
import { MockMemoryExtractor } from "./mock-memory-extractor.js";
import { OllamaMemoryExtractor } from "./ollama-memory-extractor.js";
import { OpenAiMemoryExtractor } from "./openai-memory-extractor.js";

export async function createMemoryExtractor(
  config: AppConfig,
): Promise<MemoryExtractionGateway> {
  if (config.aiProvider === "mock") return new MockMemoryExtractor();

  const instructions = await readFile(
    resolve(process.cwd(), "config/prompts/memory-extractor-v1.md"),
    "utf8",
  );

  if (config.aiProvider === "ollama") {
    return new OllamaMemoryExtractor(
      config.ollamaBaseUrl,
      config.ollamaMemoryModel,
      instructions,
    );
  }

  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI memory extraction.");
  }
  return new OpenAiMemoryExtractor(config.openAiApiKey, config.models.fast, instructions);
}
