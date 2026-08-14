import type { FastifyInstance } from "fastify";
import type { AssistantGateway } from "../../core/chat/types.js";
import type { AppConfig } from "../../shared/config.js";
import type { DatabasePool } from "../../infrastructure/db/pool.js";

export function registerHealthRoute(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; assistant: AssistantGateway; config: AppConfig },
) {
  app.get("/api/v1/health", async (_request, reply) => {
    const startedAt = performance.now();
    try {
      await dependencies.pool.query("SELECT 1");
      return {
        status: "ok",
        database: "connected",
        provider: dependencies.assistant.provider,
        model: dependencies.assistant.model,
        environment: dependencies.config.appEnv,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      app.log.error({ error }, "Health check failed");
      return reply.status(503).send({
        status: "degraded",
        database: "unavailable",
        provider: dependencies.assistant.provider,
      });
    }
  });
}
