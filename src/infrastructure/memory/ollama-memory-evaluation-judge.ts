import { isAbortError, ProviderError } from "../../core/chat/generation-errors.js";
import type { MemoryEvaluationJudgeGateway } from "../../core/evaluation/memory-evaluation.js";
import {
  memoryEvaluationJudgementJsonSchema,
  parseMemoryEvaluationJudgement,
} from "./memory-evaluation-schema.js";

interface OllamaJudgeResponse {
  message?: { content?: string };
  error?: string;
}

export class OllamaMemoryEvaluationJudge implements MemoryEvaluationJudgeGateway {
  public readonly provider = "ollama";

  public constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly instructions: string,
  ) {}

  public async judge(input: Parameters<MemoryEvaluationJudgeGateway["judge"]>[0]) {
    const { signal, ...payload } = input;
    let response: Response;
    try {
      response = await fetch(this.baseUrl.replace(/\/$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal ?? null,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: this.instructions },
            { role: "user", content: JSON.stringify(payload) },
          ],
          stream: false,
          think: false,
          format: memoryEvaluationJudgementJsonSchema,
          options: { temperature: 0 },
        }),
      });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "I couldn’t reach Ollama to score the memory evaluation.",
        true,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        "Ollama memory evaluation failed with status " + response.status + ".",
        response.status >= 500,
      );
    }
    const body = (await response.json()) as OllamaJudgeResponse;
    if (body.error) {
      throw new ProviderError("PROVIDER_REQUEST_FAILED", "Ollama reported: " + body.error, true);
    }
    if (!body.message?.content) {
      throw new ProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Ollama returned no structured memory evaluation.",
        true,
      );
    }
    return parseMemoryEvaluationJudgement(body.message.content);
  }
}
