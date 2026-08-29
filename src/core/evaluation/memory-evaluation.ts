import type { AssistantContextBlock, AssistantGateway, Message } from "../chat/types.js";

export interface MemoryEvaluationCase {
  id: string;
  prompt: string;
  memory: {
    kind: string;
    subject: string;
    content: string;
  };
  expectedClaims: string[];
  forbiddenClaims: string[];
}

export interface MemoryEvaluationScore {
  relevance: number;
  groundedness: number;
  usefulness: number;
  overall: number;
}

export interface MemoryEvaluationJudgement {
  baseline: MemoryEvaluationScore;
  enriched: MemoryEvaluationScore;
  winner: "baseline" | "enriched" | "tie";
  memoryUsedCorrectly: boolean;
  inventedClaims: string[];
  rationale: string;
}

export interface MemoryEvaluationJudgeGateway {
  readonly provider: string;
  readonly model: string;
  judge(input: {
    testCase: MemoryEvaluationCase;
    baselineAnswer: string;
    enrichedAnswer: string;
    signal?: AbortSignal;
  }): Promise<MemoryEvaluationJudgement>;
}

export interface MemoryEvaluationCaseResult {
  id: string;
  prompt: string;
  baselineAnswer: string;
  enrichedAnswer: string;
  judgement: MemoryEvaluationJudgement;
  improvement: number;
}

export interface MemoryEvaluationReport {
  version: 1;
  generatedAt: string;
  assistant: { provider: string; model: string };
  judge: { provider: string; model: string };
  cases: MemoryEvaluationCaseResult[];
  summary: {
    cases: number;
    enrichedWins: number;
    ties: number;
    baselineWins: number;
    correctMemoryUseRate: number;
    averageImprovement: number;
  };
}

async function collectReply(
  assistant: AssistantGateway,
  prompt: string,
  context: ReadonlyArray<AssistantContextBlock>,
  signal?: AbortSignal,
): Promise<string> {
  let answer = "";
  const message = { role: "user", content: prompt } satisfies Pick<Message, "role" | "content">;
  for await (const chunk of assistant.streamReply({
    messages: [message],
    context,
    ...(signal ? { signal } : {}),
  })) {
    if (chunk.type === "delta") answer += chunk.text;
  }
  if (!answer.trim()) throw new Error("The evaluated assistant returned an empty answer.");
  return answer;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export async function evaluateMemoryAnswers(input: {
  cases: ReadonlyArray<MemoryEvaluationCase>;
  assistant: AssistantGateway;
  judge: MemoryEvaluationJudgeGateway;
  signal?: AbortSignal;
}): Promise<MemoryEvaluationReport> {
  const results: MemoryEvaluationCaseResult[] = [];

  for (const testCase of input.cases) {
    input.signal?.throwIfAborted();
    const baselineAnswer = await collectReply(input.assistant, testCase.prompt, [], input.signal);
    const enrichedAnswer = await collectReply(
      input.assistant,
      testCase.prompt,
      [
        {
          id: "evaluation-memory:" + testCase.id,
          source: "approved-memory",
          title: "Approved " + testCase.memory.kind + ": " + testCase.memory.subject,
          trust: "application",
          content: JSON.stringify({
            kind: testCase.memory.kind,
            subject: testCase.memory.subject,
            claim: testCase.memory.content,
            evaluationFixture: true,
          }),
        },
      ],
      input.signal,
    );
    const judgement = await input.judge.judge({
      testCase,
      baselineAnswer,
      enrichedAnswer,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    results.push({
      id: testCase.id,
      prompt: testCase.prompt,
      baselineAnswer,
      enrichedAnswer,
      judgement,
      improvement: round(judgement.enriched.overall - judgement.baseline.overall),
    });
  }

  const enrichedWins = results.filter((result) => result.judgement.winner === "enriched").length;
  const ties = results.filter((result) => result.judgement.winner === "tie").length;
  const correct = results.filter((result) => result.judgement.memoryUsedCorrectly).length;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    assistant: { provider: input.assistant.provider, model: input.assistant.model },
    judge: { provider: input.judge.provider, model: input.judge.model },
    cases: results,
    summary: {
      cases: results.length,
      enrichedWins,
      ties,
      baselineWins: results.length - enrichedWins - ties,
      correctMemoryUseRate: results.length ? round(correct / results.length) : 0,
      averageImprovement: results.length
        ? round(results.reduce((sum, result) => sum + result.improvement, 0) / results.length)
        : 0,
    },
  };
}
