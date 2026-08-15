import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ChatService } from "../../core/chat/chat-service.js";
import type { ActivityRepository, ChatStreamEvent } from "../../core/chat/types.js";
import { AppError } from "../../shared/errors.js";

const chatRequestSchema = z.object({
  threadId: z.uuid().optional(),
  content: z.string().trim().min(1).max(32_000),
});

const retryRequestSchema = z.object({
  threadId: z.uuid(),
  userMessageId: z.uuid(),
});

const activityIdSchema = z.object({ id: z.uuid() });

function writeEvent(response: NodeJS.WritableStream, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  createEvents: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>,
  fallbackUserMessageId: string | null,
) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.flushHeaders();

  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.raw.once("aborted", abort);
  reply.raw.once("error", abort);
  reply.raw.once("close", () => {
    if (!reply.raw.writableEnded) abort();
  });

  try {
    for await (const event of createEvents(abortController.signal)) {
      if (reply.raw.destroyed) break;
      writeEvent(reply.raw, event.type, event);
    }
  } catch (error) {
    if (!reply.raw.destroyed) {
      writeEvent(reply.raw, "error", {
        type: "error",
        code: error instanceof AppError ? error.code : "REQUEST_FAILED",
        message: error instanceof Error ? error.message : "The request failed.",
        retryable: false,
        userMessageId: fallbackUserMessageId,
        partial: false,
      } satisfies ChatStreamEvent);
    }
  } finally {
    request.raw.off("aborted", abort);
    reply.raw.off("error", abort);
    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
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

    return streamEvents(
      request,
      reply,
      (signal) =>
        dependencies.chatService.reply({
          content: parsed.data.content,
          ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
          signal,
        }),
      null,
    );
  });

  app.post("/api/v1/chat/retry", async (request, reply) => {
    const parsed = retryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_RETRY_REQUEST",
        message: parsed.error.issues[0]?.message ?? "Invalid retry target.",
      });
    }

    return streamEvents(
      request,
      reply,
      (signal) => dependencies.chatService.retry({ ...parsed.data, signal }),
      parsed.data.userMessageId,
    );
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
