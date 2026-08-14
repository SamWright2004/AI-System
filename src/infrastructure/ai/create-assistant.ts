import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssistantGateway } from "../../core/chat/types.js";
import type { AppConfig } from "../../shared/config.js";
import { MockAssistantGateway } from "./mock-assistant.js";
import { OpenAiAssistantGateway } from "./openai-assistant.js";

export async function createAssistant(config: AppConfig): Promise<AssistantGateway> {
  if (config.aiProvider === "mock") {
    return new MockAssistantGateway();
  }

  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for the OpenAI provider.");
  }

  const instructions = await readFile(
    resolve(process.cwd(), "config/prompts/assistant-v1.md"),
    "utf8",
  );

  return new OpenAiAssistantGateway(config.openAiApiKey, config.models.chat, instructions);
}
