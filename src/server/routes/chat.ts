import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatService } from "../../core/chat/chat-service.js";
import type { ActivityRepository } from "../../core/chat/types.js";

const chatRequestSchema = z.object({
  threadId: z.uuid().optional(),
  content: z.string().trim().min(1).max(32_000),
});

const activityIdSchema = z.object({ id: z.uuid() });

function writeEvent(response: NodeJS.WritableStream, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerChatRoutes(
  app: FastifyInstance,
  dependencies: { chatService: ChatService; activity: ActivityRepository },
) {
  app.get("/api/v1/bootstrap", async () => dependencies.chatService.getHomeState());

  app.post("/api/v1/chat/stream", async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_CHAT_REQUEST",
        message: parsed.error.issues[0]?.message ?? "Invalid message.",
      });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders();

    const abortController = new AbortController();
    reply.raw.on("close", () => abortController.abort());

    try {
      for await (const event of dependencies.chatService.reply({
        content: parsed.data.content,
        ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
        signal: abortController.signal,
      })) {
        writeEvent(reply.raw, event.type, event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The request failed.";
      writeEvent(reply.raw, "error", { type: "error", message });
    } finally {
      reply.raw.end();
    }
  });

  app.post("/api/v1/activity/:id/read", async (request, reply) => {
    const parsed = activityIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_ACTIVITY_ID" });
    }
    await dependencies.activity.markRead(parsed.data.id);
    return reply.status(204).send();
  });
}
