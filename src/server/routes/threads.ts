import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatService } from "../../core/chat/chat-service.js";

const threadIdSchema = z.object({ id: z.uuid() });
const threadTitleSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export function registerThreadRoutes(
  app: FastifyInstance,
  dependencies: { chatService: ChatService },
) {
  app.get("/api/v1/threads/:id", async (request, reply) => {
    const parsed = threadIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_THREAD_ID" });
    }
    return dependencies.chatService.getThreadState(parsed.data.id);
  });

  app.patch("/api/v1/threads/:id", async (request, reply) => {
    const id = threadIdSchema.safeParse(request.params);
    const body = threadTitleSchema.safeParse(request.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({
        error: "INVALID_THREAD_UPDATE",
        message: body.success ? "Invalid conversation id." : body.error.issues[0]?.message,
      });
    }
    return dependencies.chatService.renameThread(id.data.id, body.data.title);
  });

  app.delete("/api/v1/threads/:id", async (request, reply) => {
    const parsed = threadIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_THREAD_ID" });
    }
    await dependencies.chatService.archiveThread(parsed.data.id);
    return reply.status(204).send();
  });
}
