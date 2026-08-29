import { describe, expect, it } from "vitest";
import type { Message, Thread } from "../src/core/chat/types.js";
import type { ProjectRepository } from "../src/core/projects/types.js";
import { ProjectContextSource } from "../src/infrastructure/context/project-context-source.js";

const currentMessage: Message = {
  id: "22222222-2222-4222-8222-222222222222",
  threadId: "11111111-1111-4111-8111-111111111111",
  role: "user",
  content: "What is the next useful step?",
  status: "complete",
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
  metadata: {},
  createdAt: "2026-08-29T12:00:00.000Z",
};

function thread(projectId: string | null): Thread {
  return {
    id: currentMessage.threadId,
    title: "Project conversation",
    kind: projectId ? "project" : "temporary",
    projectId,
    createdAt: currentMessage.createdAt,
    updatedAt: currentMessage.createdAt,
  };
}

describe("ProjectContextSource", () => {
  it("keeps ordinary conversations free from project context", async () => {
    let queried = false;
    const repository: Pick<ProjectRepository, "findContextForThread"> = {
      async findContextForThread() {
        queried = true;
        return null;
      },
    };
    const source = new ProjectContextSource(repository);

    await expect(source.load({ thread: thread(null), currentMessage })).resolves.toEqual([]);
    expect(queried).toBe(false);
  });

  it("emits bounded canonical state only for the explicitly linked project", async () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    const repository: Pick<ProjectRepository, "findContextForThread"> = {
      async findContextForThread(threadId) {
        expect(threadId).toBe(currentMessage.threadId);
        return {
          project: {
            id: projectId,
            name: "KSP short film",
            description: "Finish a face-free emotional short film.",
            status: "active",
            createdAt: currentMessage.createdAt,
            updatedAt: currentMessage.createdAt,
          },
          tasks: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              projectId,
              title: "Polish the next Blender shot",
              description: "",
              status: "ready",
              priority: 80,
              dueAt: null,
              createdAt: currentMessage.createdAt,
              updatedAt: currentMessage.createdAt,
              completedAt: null,
            },
          ],
        };
      },
    };
    const source = new ProjectContextSource(repository);

    const result = await source.load({ thread: thread(projectId), currentMessage });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "active-project",
      trust: "application",
      priority: 850,
      title: "Selected project: KSP short film",
    });
    expect(result[0]?.content).toContain("Polish the next Blender shot");
    expect(result[0]?.content).toContain("Do not invent progress beyond it.");
  });
});
