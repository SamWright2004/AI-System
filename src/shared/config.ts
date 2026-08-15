import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const booleanFromString = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4310),
  WEB_ORIGIN: z.url().default("http://127.0.0.1:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://personal_ai:personal_ai_dev@127.0.0.1:5434/personal_ai"),
  AI_PROVIDER: z.enum(["mock", "openai", "ollama"]).default("mock"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_DEEP_MODEL: z.string().default("gpt-5.6"),
  OPENAI_FAST_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  OLLAMA_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen3.5:4b"),
  OLLAMA_THINK: booleanFromString.default(false),

  CONTEXT_INPUT_TOKEN_BUDGET: z.coerce.number().int().min(512).max(1_000_000).default(12_000),
  CONTEXT_HISTORY_PAGE_SIZE: z.coerce.number().int().min(10).max(250).default(50),
  PERSONALISATION_FILE: z
    .string()
    .min(1)
    .default("config/personalisation/profile.local.json"),

  APP_SECRET: z.string().min(16).default("development-only-secret-change-me"),
  SERVE_UI: booleanFromString.default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
}

if (parsed.data.AI_PROVIDER === "openai" && !parsed.data.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
}

export const config = Object.freeze({
  appEnv: parsed.data.APP_ENV,
  apiHost: parsed.data.API_HOST,
  apiPort: parsed.data.API_PORT,
  webOrigin: parsed.data.WEB_ORIGIN,
  logLevel: parsed.data.LOG_LEVEL,
  databaseUrl: parsed.data.DATABASE_URL,
  aiProvider: parsed.data.AI_PROVIDER,

  openAiApiKey: parsed.data.OPENAI_API_KEY,
  models: {
    chat: parsed.data.OPENAI_CHAT_MODEL,
    deep: parsed.data.OPENAI_DEEP_MODEL,
    fast: parsed.data.OPENAI_FAST_MODEL,
    embedding: parsed.data.OPENAI_EMBEDDING_MODEL,
  },

  ollamaBaseUrl: parsed.data.OLLAMA_BASE_URL,
  ollamaChatModel: parsed.data.OLLAMA_CHAT_MODEL,
  ollamaThink: parsed.data.OLLAMA_THINK,

  contextInputTokenBudget: parsed.data.CONTEXT_INPUT_TOKEN_BUDGET,
  contextHistoryPageSize: parsed.data.CONTEXT_HISTORY_PAGE_SIZE,
  personalisationFile: parsed.data.PERSONALISATION_FILE,

  appSecret: parsed.data.APP_SECRET,
  serveUi: parsed.data.SERVE_UI,
});

export type AppConfig = typeof config;
