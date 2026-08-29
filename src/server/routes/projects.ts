import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProjectService } from "../../core/projects/project-service.js";
import { projectStatuses, taskStatuses } from "../../core/projects/types.js";

const idSchema = z.object({ id: z.uuid() });
const linkSchema = z.object({ id: z.uuid(), threadId: z.uuid() });
const editableProjectStatuses = projectStatuses.filter((status) => status !== "archived");
const projectDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4_000),
    status: z.enum(editableProjectStatuses),
  })
  .strict();
const projectTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000),
    status: z.enum(taskStatuses),
    priority: z.number().int().min(-100).max(100),
    dueAt: z.iso.datetime().nullable(),
  })
  .strict();

export function registerProjectRoutes(
  app: FastifyInstance,
  dependencies: { projectService: ProjectService },
) {
  app.get("/api/v1/projects", async () => dependencies.projectService.list());

  app.get("/api/v1/projects/:id", async (request, reply) => {
    const parsed = idSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "INVALID_PROJECT_ID" });
    return dependencies.projectService.get(parsed.data.id);
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const parsed = projectDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_PROJECT",
        message: parsed.error.issues[0]?.message ?? "Invalid project.",
      });
    }
    return reply.status(201).send(await dependencies.projectService.create(parsed.data));
  });

  app.patch("/api/v1/projects/:id", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = projectDraftSchema.safeParse(request.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({
        error: "INVALID_PROJECT_UPDATE",
        message: body.success ? "Invalid project id." : body.error.issues[0]?.message,
      });
    }
    return dependencies.projectService.update(id.data.id, body.data);
  });

  app.delete("/api/v1/projects/:id", async (request, reply) => {
    const parsed = idSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "INVALID_PROJECT_ID" });
    await dependencies.projectService.archive(parsed.data.id);
    return reply.status(204).send();
  });

  app.post("/api/v1/projects/:id/threads/:threadId", async (request, reply) => {
    const parsed = linkSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "INVALID_PROJECT_LINK" });
    return dependencies.projectService.linkThread(parsed.data.id, parsed.data.threadId);
  });

  app.delete("/api/v1/projects/:id/threads/:threadId", async (request, reply) => {
    const parsed = linkSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "INVALID_PROJECT_LINK" });
    return dependencies.projectService.unlinkThread(parsed.data.id, parsed.data.threadId);
  });

  app.post("/api/v1/projects/:id/tasks", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = projectTaskSchema.safeParse(request.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({
        error: "INVALID_PROJECT_TASK",
        message: body.success ? "Invalid project id." : body.error.issues[0]?.message,
      });
    }
    return reply
      .status(201)
      .send(await dependencies.projectService.createTask(id.data.id, body.data));
  });

  app.patch("/api/v1/project-tasks/:id", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = projectTaskSchema.safeParse(request.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({
        error: "INVALID_PROJECT_TASK",
        message: body.success ? "Invalid task id." : body.error.issues[0]?.message,
      });
    }
    return dependencies.projectService.updateTask(id.data.id, body.data);
  });
}
