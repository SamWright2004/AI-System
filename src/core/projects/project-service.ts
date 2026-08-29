import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { ConversationRepository } from "../chat/types.js";
import type {
  Project,
  ProjectDraft,
  ProjectRepository,
  ProjectTask,
  ProjectTaskDraft,
  ProjectThreadLink,
  ProjectWorkspace,
} from "./types.js";

export class ProjectService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  public async list() {
    return this.projects.listProjects(100);
  }

  public async get(id: string): Promise<ProjectWorkspace> {
    const workspace = await this.projects.getWorkspace(id);
    if (!workspace) throw new NotFoundError("That project no longer exists.");
    return workspace;
  }

  public async create(input: ProjectDraft): Promise<Project> {
    return this.projects.createProject(input);
  }

  public async update(id: string, input: ProjectDraft): Promise<Project> {
    const project = await this.projects.updateProject(id, input);
    if (!project) throw new NotFoundError("That project no longer exists.");
    return project;
  }

  public async archive(id: string): Promise<void> {
    if (!(await this.projects.archiveProject(id))) {
      throw new NotFoundError("That project no longer exists.");
    }
  }

  public async linkThread(projectId: string, threadId: string): Promise<ProjectThreadLink> {
    const [project, thread] = await Promise.all([
      this.projects.findProject(projectId),
      this.conversations.findThread(threadId),
    ]);
    if (!project) throw new NotFoundError("That project no longer exists.");
    if (!thread) throw new NotFoundError("That conversation no longer exists.");
    if (!(await this.projects.linkThread(project.id, thread.id))) {
      throw new ConflictError("The conversation could not be linked to that project.");
    }
    const updated = await this.conversations.findThread(thread.id);
    if (!updated) throw new NotFoundError("That conversation no longer exists.");
    return { thread: updated, project };
  }

  public async unlinkThread(projectId: string, threadId: string): Promise<ProjectThreadLink> {
    const thread = await this.conversations.findThread(threadId);
    if (!thread) throw new NotFoundError("That conversation no longer exists.");
    if (!(await this.projects.unlinkThread(projectId, threadId))) {
      throw new ConflictError("That conversation is not linked to this project.");
    }
    const updated = await this.conversations.findThread(thread.id);
    if (!updated) throw new NotFoundError("That conversation no longer exists.");
    return { thread: updated, project: null };
  }

  public async createTask(projectId: string, input: ProjectTaskDraft): Promise<ProjectTask> {
    const task = await this.projects.createTask(projectId, input);
    if (!task) throw new NotFoundError("That project no longer exists.");
    return task;
  }

  public async updateTask(id: string, input: ProjectTaskDraft): Promise<ProjectTask> {
    if (!(await this.projects.findTask(id))) {
      throw new NotFoundError("That project task no longer exists.");
    }
    const task = await this.projects.updateTask(id, input);
    if (!task) throw new ConflictError("The project task changed before it could be saved.");
    return task;
  }
}
