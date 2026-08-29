import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ProviderError } from "../../core/chat/generation-errors.js";
import type { MemoryEvaluationJudgeGateway } from "../../core/evaluation/memory-evaluation.js";
import { memoryEvaluationJudgementSchema } from "./memory-evaluation-schema.js";

export class OpenAiMemoryEvaluationJudge implements MemoryEvaluationJudgeGateway {
  public readonly provider = "openai";
  private readonly client: OpenAI;

  public constructor(
    apiKey: string,
    public readonly model: string,
    private readonly instructions: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  public async judge(input: Parameters<MemoryEvaluationJudgeGateway["judge"]>[0]) {
    try {
      const { signal, ...payload } = input;
      const response = await this.client.responses.parse(
        {
          model: this.model,
          input: [
            { role: "system", content: this.instructions },
            { role: "user", content: JSON.stringify(payload) },
          ],
          text: { format: zodTextFormat(memoryEvaluationJudgementSchema, "memory_evaluation") },
          max_output_tokens: 2_000,
          store: false,
        },
        signal ? { signal } : undefined,
      );
      return memoryEvaluationJudgementSchema.parse(response.output_parsed);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "PROVIDER_REQUEST_FAILED",
        "OpenAI could not score the memory evaluation.",
        true,
        { cause: error },
      );
    }
  }
}
