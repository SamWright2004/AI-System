import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ChatService } from "../core/chat/chat-service.js";
import { ContextAssembler } from "../core/context/context-assembler.js";
import { MemoryService } from "../core/memory/memory-service.js";
import { HybridMemoryRetriever } from "../core/memory/hybrid-memory-retriever.js";
import { MemoryIndexer } from "../core/memory/memory-indexer.js";
import { ProjectService } from "../core/projects/project-service.js";
import { createAssistant } from "../infrastructure/ai/create-assistant.js";
import { DatabaseMemorySource } from "../infrastructure/context/database-memory-source.js";
import { FilePersonalisationSource } from "../infrastructure/context/file-personalisation-source.js";
import { ProjectContextSource } from "../infrastructure/context/project-context-source.js";
import { createPool } from "../infrastructure/db/pool.js";
import { PostgresMemoryRepository } from "../infrastructure/db/postgres-memory-repository.js";
import { PostgresProjectRepository } from "../infrastructure/db/postgres-project-repository.js";
import { PostgresStore } from "../infrastructure/db/postgres-store.js";
import { createMemoryExtractor } from "../infrastructure/memory/create-memory-extractor.js";
import { createMemoryEmbeddingGateway } from "../infrastructure/memory/create-memory-embedding.js";
import { AppError } from "../shared/errors.js";
import type { AppConfig } from "../shared/config.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerThreadRoutes } from "./routes/threads.js";

export async function createApp(config: AppConfig) {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 1_000_000,
    requestTimeout: 120_000,
  });

  await app.register(cors, {
    origin: config.appEnv === "development" ? [config.webOrigin] : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });

  const pool = createPool(config.databaseUrl);
  const store = new PostgresStore(pool);
  const memoryRepository = new PostgresMemoryRepository(pool);
  const projectRepository = new PostgresProjectRepository(pool);
  const [assistant, memoryExtractor] = await Promise.all([
    createAssistant(config),
    createMemoryExtractor(config),
  ]);
  const memoryEmbeddings = createMemoryEmbeddingGateway(config);
  const memoryIndexer = memoryEmbeddings
    ? new MemoryIndexer(memoryRepository, memoryEmbeddings, config.memoryContextMaxSensitivity)
    : null;
  const memoryRetriever = new HybridMemoryRetriever(
    memoryRepository,
    memoryEmbeddings,
    memoryIndexer,
    {
      autoIndexLimit: config.memoryAutoIndexLimit,
      minimumSemanticScore: config.memorySemanticMinScore,
    },
  );
  const personalisation = new FilePersonalisationSource(config.personalisationFile);
  const memorySource = new DatabaseMemorySource(
    memoryRetriever,
    config.memoryContextMaxSensitivity,
  );
  const projectSource = new ProjectContextSource(projectRepository);
  const contextAssembler = new ContextAssembler(store, {
    inputTokenBudget: config.contextInputTokenBudget,
    historyPageSize: config.contextHistoryPageSize,
    sources: [personalisation, projectSource, memorySource],
  });
  const chatService = new ChatService(
    store,
    store,
    assistant,
    contextAssembler,
    personalisation,
    {
      provider: assistant.provider,
      model: assistant.model,
      contextInputTokenBudget: config.contextInputTokenBudget,
    },
    projectRepository,
  );
  const memoryService = new MemoryService(
    memoryRepository,
    store,
    memoryExtractor,
    config.memoryContextMaxSensitivity,
    memoryRetriever,
    memoryIndexer ?? undefined,
  );
  const projectService = new ProjectService(projectRepository, store);

  registerHealthRoute(app, { pool, assistant, config });
  registerChatRoutes(app, { chatService, activity: store });
  registerThreadRoutes(app, { chatService });
  registerMemoryRoutes(app, { memoryService });
  registerProjectRoutes(app, { projectService });
  registerSettingsRoutes(app, { personalisation });

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
