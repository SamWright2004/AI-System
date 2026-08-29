import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryEvaluationJudgeGateway } from "../../core/evaluation/memory-evaluation.js";
import type { AppConfig } from "../../shared/config.js";
import { MockMemoryEvaluationJudge } from "./mock-memory-evaluation-judge.js";
import { OllamaMemoryEvaluationJudge } from "./ollama-memory-evaluation-judge.js";
import { OpenAiMemoryEvaluationJudge } from "./openai-memory-evaluation-judge.js";

export async function createMemoryEvaluationJudge(
  config: AppConfig,
): Promise<MemoryEvaluationJudgeGateway> {
  if (config.aiProvider === "mock") return new MockMemoryEvaluationJudge();
  const instructions = await readFile(
    resolve(process.cwd(), "config/prompts/memory-evaluator-v1.md"),
    "utf8",
  );
  if (config.aiProvider === "ollama") {
    return new OllamaMemoryEvaluationJudge(
      config.ollamaBaseUrl,
      config.ollamaMemoryModel,
      instructions,
    );
  }
  if (!config.openAiApiKey) throw new Error("OPENAI_API_KEY is required for memory evaluation.");
  return new OpenAiMemoryEvaluationJudge(config.openAiApiKey, config.models.fast, instructions);
}
