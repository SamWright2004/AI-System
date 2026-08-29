import type {
  ContextCandidate,
  ContextSource,
  ContextSourceInput,
} from "../../core/context/types.js";
import type { ProjectRepository } from "../../core/projects/types.js";

export class ProjectContextSource implements ContextSource {
  public readonly id = "active-project";

  public constructor(private readonly projects: Pick<ProjectRepository, "findContextForThread">) {}

  public async load(input: ContextSourceInput): Promise<ReadonlyArray<ContextCandidate>> {
    if (!input.thread.projectId) return [];
    const state = await this.projects.findContextForThread(input.thread.id);
    if (!state) return [];

    const openTasks = state.tasks
      .filter((task) => task.status !== "done" && task.status !== "cancelled")
      .slice(0, 16)
      .map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
      }));
    const recentlyCompleted = state.tasks
      .filter((task) => task.status === "done")
      .slice(0, 4)
      .map((task) => ({ title: task.title, completedAt: task.completedAt }));

    return [
      {
        id: "project:" + state.project.id,
        source: this.id,
        title: "Selected project: " + state.project.name,
        trust: "application",
        priority: 850,
        content: JSON.stringify({
          id: state.project.id,
          name: state.project.name,
          description: state.project.description,
          status: state.project.status,
          openTasks,
          recentlyCompleted,
          instruction:
            "Treat this as canonical project state for this conversation. Do not invent progress beyond it.",
        }),
      },
    ];
  }
}
