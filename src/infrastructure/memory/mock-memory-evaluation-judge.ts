import type {
  MemoryEvaluationJudgeGateway,
  MemoryEvaluationScore,
} from "../../core/evaluation/memory-evaluation.js";

function contains(answer: string, claim: string): boolean {
  const terms = claim.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalised = answer.toLowerCase();
  return terms.filter((term) => term.length > 3).every((term) => normalised.includes(term));
}

function score(answer: string, expected: string[], forbidden: string[]): MemoryEvaluationScore {
  const expectedRate = expected.length
    ? expected.filter((claim) => contains(answer, claim)).length / expected.length
    : 1;
  const inventedRate = forbidden.length
    ? forbidden.filter((claim) => contains(answer, claim)).length / forbidden.length
    : 0;
  const groundedness = 1 - inventedRate;
  const overall = expectedRate * 0.65 + groundedness * 0.35;
  return {
    relevance: expectedRate,
    groundedness,
    usefulness: expectedRate,
    overall,
  };
}

export class MockMemoryEvaluationJudge implements MemoryEvaluationJudgeGateway {
  public readonly provider = "mock";
  public readonly model = "deterministic-claim-check-v1";

  public async judge(input: Parameters<MemoryEvaluationJudgeGateway["judge"]>[0]) {
    const baseline = score(
      input.baselineAnswer,
      input.testCase.expectedClaims,
      input.testCase.forbiddenClaims,
    );
    const enriched = score(
      input.enrichedAnswer,
      input.testCase.expectedClaims,
      input.testCase.forbiddenClaims,
    );
    const difference = enriched.overall - baseline.overall;
    return {
      baseline,
      enriched,
      winner: difference > 0.02 ? "enriched" : difference < -0.02 ? "baseline" : "tie",
      memoryUsedCorrectly: enriched.relevance === 1 && enriched.groundedness === 1,
      inventedClaims: input.testCase.forbiddenClaims.filter((claim) =>
        contains(input.enrichedAnswer, claim),
      ),
      rationale: "Deterministic expected-claim and forbidden-claim check.",
    } as const;
  }
}
