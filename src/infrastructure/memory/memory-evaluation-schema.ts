import { z } from "zod";

const scoreSchema = z
  .object({
    relevance: z.number().min(0).max(1),
    groundedness: z.number().min(0).max(1),
    usefulness: z.number().min(0).max(1),
    overall: z.number().min(0).max(1),
  })
  .strict();

export const memoryEvaluationJudgementSchema = z
  .object({
    baseline: scoreSchema,
    enriched: scoreSchema,
    winner: z.enum(["baseline", "enriched", "tie"]),
    memoryUsedCorrectly: z.boolean(),
    inventedClaims: z.array(z.string().trim().min(1).max(300)).max(20),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const memoryEvaluationJudgementJsonSchema = z.toJSONSchema(memoryEvaluationJudgementSchema);

export const memoryEvaluationCasesSchema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(40),
        prompt: z.string().trim().min(1).max(4_000),
        memory: z
          .object({
            kind: z.string().trim().min(1).max(40),
            subject: z.string().trim().min(1).max(120),
            content: z.string().trim().min(1).max(1_000),
          })
          .strict(),
        expectedClaims: z.array(z.string().trim().min(1).max(300)).max(20),
        forbiddenClaims: z.array(z.string().trim().min(1).max(300)).max(20),
      })
      .strict(),
  )
  .min(1)
  .max(100);

export function parseMemoryEvaluationJudgement(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("The memory evaluator returned invalid JSON.", { cause: error });
  }
  return memoryEvaluationJudgementSchema.parse(value);
}
