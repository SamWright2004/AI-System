import type { Thread, ThreadSummary } from "../chat/types.js";

export const projectStatuses = ["idea", "active", "paused", "completed", "archived"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const taskStatuses = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;
export type ProjectTaskStatus = (typeof taskStatuses)[number];

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  threadCount: number;
  openTaskCount: number;
  nextTask: string | null;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: ProjectTaskStatus;
  priority: number;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectDraft {
  name: string;
  description: string;
  status: Exclude<ProjectStatus, "archived">;
}

export interface ProjectTaskDraft {
  title: string;
  description: string;
  status: ProjectTaskStatus;
  priority: number;
  dueAt: string | null;
}

export interface ProjectWorkspace {
  project: Project;
  tasks: ProjectTask[];
  threads: ThreadSummary[];
}

export interface ProjectContextState {
  project: Project;
  tasks: ProjectTask[];
}

export interface ProjectRepository {
  listProjects(limit?: number): Promise<ProjectSummary[]>;
  findProject(id: string): Promise<Project | null>;
  getWorkspace(id: string): Promise<ProjectWorkspace | null>;
  createProject(input: ProjectDraft): Promise<Project>;
  updateProject(id: string, input: ProjectDraft): Promise<Project | null>;
  archiveProject(id: string): Promise<boolean>;
  linkThread(projectId: string, threadId: string): Promise<boolean>;
  unlinkThread(projectId: string, threadId: string): Promise<boolean>;
  findContextForThread(threadId: string): Promise<ProjectContextState | null>;
  createTask(projectId: string, input: ProjectTaskDraft): Promise<ProjectTask | null>;
  updateTask(id: string, input: ProjectTaskDraft): Promise<ProjectTask | null>;
  findTask(id: string): Promise<ProjectTask | null>;
}

export interface ProjectThreadLink {
  thread: Thread;
  project: Project | null;
}
