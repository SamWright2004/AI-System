import { z } from "zod";
import { memoryKinds } from "../../core/memory/types.js";

export const memoryExtractionSchema = z
  .object({
    proposals: z
      .array(
        z
          .object({
            sourceMessageId: z.uuid(),
            kind: z.enum(memoryKinds),
            subject: z.string().trim().min(1).max(120),
            content: z.string().trim().min(1).max(1_000),
            confidence: z.number().min(0).max(1),
            importance: z.number().int().min(0).max(100),
            sensitivity: z.number().int().min(0).max(3),
            rationale: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export const memoryExtractionJsonSchema = z.toJSONSchema(memoryExtractionSchema);

export function parseMemoryExtractionJson(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("The memory extractor returned invalid JSON.", { cause: error });
  }
  return memoryExtractionSchema.parse(value);
}
