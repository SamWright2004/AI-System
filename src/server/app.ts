import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ChatService } from "../core/chat/chat-service.js";
import { ContextAssembler } from "../core/context/context-assembler.js";
import { createAssistant } from "../infrastructure/ai/create-assistant.js";
import { FilePersonalisationSource } from "../infrastructure/context/file-personalisation-source.js";
import { createPool } from "../infrastructure/db/pool.js";
import { PostgresStore } from "../infrastructure/db/postgres-store.js";
import { AppError } from "../shared/errors.js";
import type { AppConfig } from "../shared/config.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoute } from "./routes/health.js";

export async function createApp(config: AppConfig) {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 1_000_000,
    requestTimeout: 120_000,
  });

  await app.register(cors, {
    origin: config.appEnv === "development" ? [config.webOrigin] : false,
    methods: ["GET", "POST"],
  });

  const pool = createPool(config.databaseUrl);
  const store = new PostgresStore(pool);
  const assistant = await createAssistant(config);
  const personalisation = new FilePersonalisationSource(config.personalisationFile);
  const contextAssembler = new ContextAssembler(store, {
    inputTokenBudget: config.contextInputTokenBudget,
    historyPageSize: config.contextHistoryPageSize,
    sources: [personalisation],
  });
  const chatService = new ChatService(
    store,
    store,
    assistant,
    contextAssembler,
    personalisation,
  );

  registerHealthRoute(app, { pool, assistant, config });
  registerChatRoutes(app, { chatService, activity: store });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }

    app.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Something failed inside the local service.",
    });
  });

  const uiRoot = resolve(process.cwd(), "dist/ui");
  if (config.serveUi && existsSync(resolve(uiRoot, "index.html"))) {
    await app.register(fastifyStatic, { root: uiRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
