import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateMemoryAnswers } from "../src/core/evaluation/memory-evaluation.js";
import { createAssistant } from "../src/infrastructure/ai/create-assistant.js";
import { createMemoryEvaluationJudge } from "../src/infrastructure/memory/create-memory-evaluation-judge.js";
import { memoryEvaluationCasesSchema } from "../src/infrastructure/memory/memory-evaluation-schema.js";
import { config } from "../src/shared/config.js";

const fixturePath = resolve(process.cwd(), "config/evaluations/memory-answer-v1.json");
const cases = memoryEvaluationCasesSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
const [assistant, judge] = await Promise.all([
  createAssistant(config),
  createMemoryEvaluationJudge(config),
]);

const report = await evaluateMemoryAnswers({ cases, assistant, judge });

console.log(`Memory answer evaluation (${report.assistant.provider}/${report.assistant.model})`);
console.log(`Judge: ${report.judge.provider}/${report.judge.model}`);
for (const result of report.cases) {
  console.log(
    `${result.id}: ${result.judgement.winner} · improvement ${result.improvement.toFixed(3)} · ` +
      `${result.judgement.memoryUsedCorrectly ? "grounded" : "review"}`,
  );
}
console.log(JSON.stringify(report.summary, null, 2));
