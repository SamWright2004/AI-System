import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MemoryService } from "../../core/memory/memory-service.js";
import { memoryKinds } from "../../core/memory/types.js";

const memoryIdSchema = z.object({ id: z.uuid() });
const threadSchema = z.object({ threadId: z.uuid() }).strict();
const memoryDraftSchema = z
  .object({
    kind: z.enum(memoryKinds),
    subject: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(1_000),
    importance: z.number().int().min(0).max(100),
    sensitivity: z.number().int().min(0).max(3),
  })
  .strict();

export function registerMemoryRoutes(
  app: FastifyInstance,
  dependencies: { memoryService: MemoryService },
) {
  app.get("/api/v1/memories", async () => dependencies.memoryService.getOverview());

  app.post("/api/v1/memories/extract", async (request, reply) => {
    const parsed = threadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_MEMORY_EXTRACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid conversation.",
      });
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once("aborted", abort);
    try {
      return await dependencies.memoryService.extractFromThread(
        parsed.data.threadId,
        controller.signal,
      );
    } finally {
      request.raw.off("aborted", abort);
    }
  });

  app.post("/api/v1/memories", async (request, reply) => {
    const parsed = memoryDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_MEMORY",
        message: parsed.error.issues[0]?.message ?? "Invalid memory.",
      });
    }
    return reply.status(201).send(await dependencies.memoryService.createOwnerMemory(parsed.data));
  });

  app.patch("/api/v1/memories/:id", async (request, reply) => {
    const id = memoryIdSchema.safeParse(request.params);
    const body = memoryDraftSchema.safeParse(request.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({
        error: "INVALID_MEMORY_UPDATE",
        message: body.success ? "Invalid memory id." : body.error.issues[0]?.message,
      });
    }
    return dependencies.memoryService.edit(id.data.id, body.data);
  });

  app.post("/api/v1/memories/:id/approve", async (request, reply) => {
    const parsed = memoryIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_MEMORY_ID", message: "Invalid memory id." });
    }
    return dependencies.memoryService.approve(parsed.data.id);
  });

  app.post("/api/v1/memories/:id/reject", async (request, reply) => {
    const parsed = memoryIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_MEMORY_ID", message: "Invalid memory id." });
    }
    return dependencies.memoryService.reject(parsed.data.id);
  });

  app.delete("/api/v1/memories/:id", async (request, reply) => {
    const parsed = memoryIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_MEMORY_ID", message: "Invalid memory id." });
    }
    await dependencies.memoryService.forget(parsed.data.id);
    return reply.status(204).send();
  });
}
