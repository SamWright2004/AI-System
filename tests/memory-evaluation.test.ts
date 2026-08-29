import { describe, expect, it } from "vitest";
import { evaluateMemoryAnswers } from "../src/core/evaluation/memory-evaluation.js";
import type { AssistantGateway, AssistantInput } from "../src/core/chat/types.js";
import { MockMemoryEvaluationJudge } from "../src/infrastructure/memory/mock-memory-evaluation-judge.js";

class ContextAwareAssistant implements AssistantGateway {
  public readonly provider = "test";
  public readonly model = "context-aware";

  public async *streamReply(input: AssistantInput) {
    const response = input.context.length
      ? "Use metric units by default, then note any source-specific exception."
      : "Use the units that best fit the design.";
    yield { type: "delta" as const, text: response };
  }
}

describe("memory answer evaluation", () => {
  it("compares the same assistant with and without approved memory", async () => {
    const report = await evaluateMemoryAnswers({
      assistant: new ContextAwareAssistant(),
      judge: new MockMemoryEvaluationJudge(),
      cases: [
        {
          id: "A01",
          prompt: "Which units should I use?",
          memory: {
            kind: "preference",
            subject: "Measurement units",
            content: "The owner prefers metric units by default.",
          },
          expectedClaims: ["Use metric units"],
          forbiddenClaims: ["Use imperial units"],
        },
      ],
    });

    expect(report.summary).toMatchObject({
      cases: 1,
      enrichedWins: 1,
      correctMemoryUseRate: 1,
    });
    expect(report.cases[0]).toMatchObject({
      id: "A01",
      judgement: { winner: "enriched", memoryUsedCorrectly: true },
    });
  });
});
