import type { ThreadSummary } from "../../core/chat/types.js";
import type {
  Project,
  ProjectContextState,
  ProjectDraft,
  ProjectRepository,
  ProjectSummary,
  ProjectTask,
  ProjectTaskDraft,
  ProjectWorkspace,
} from "../../core/projects/types.js";
import type { DatabasePool } from "./pool.js";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  status: Project["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProjectSummaryRow extends ProjectRow {
  thread_count: number;
  open_task_count: number;
  next_task: string | null;
}

interface ProjectTaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ProjectTask["status"];
  priority: number;
  due_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

interface ProjectThreadRow {
  id: string;
  title: string;
  kind: ThreadSummary["kind"];
  project_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  message_count: number;
  last_message_preview: string | null;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapTask(row: ProjectTaskRow): ProjectTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: optionalIso(row.due_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    completedAt: optionalIso(row.completed_at),
  };
}

function mapThread(row: ProjectThreadRow): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    projectId: row.project_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    messageCount: row.message_count,
    lastMessagePreview: row.last_message_preview,
  };
}

const taskColumns = [
  "id",
  "project_id",
  "title",
  "description",
  "status",
  "priority",
  "due_at",
  "created_at",
  "updated_at",
  "completed_at",
].join(", ");

export class PostgresProjectRepository implements ProjectRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async listProjects(limit = 100): Promise<ProjectSummary[]> {
    const result = await this.pool.query<ProjectSummaryRow>(
      [
        "SELECT project.id, project.name, project.description, project.status,",
        "  project.created_at, project.updated_at,",
        "  COUNT(DISTINCT thread.id)::int AS thread_count,",
        "  COUNT(DISTINCT task.id) FILTER (",
        "    WHERE task.status NOT IN ('done', 'cancelled')",
        "  )::int AS open_task_count,",
        "  (SELECT next_task.title FROM tasks AS next_task",
        "   WHERE next_task.project_id = project.id",
        "     AND next_task.status NOT IN ('done', 'cancelled')",
        "   ORDER BY",
        "     CASE next_task.status WHEN 'in_progress' THEN 0 WHEN 'ready' THEN 1",
        "       WHEN 'blocked' THEN 2 WHEN 'review' THEN 3 ELSE 4 END,",
        "     next_task.priority DESC, next_task.updated_at DESC",
        "   LIMIT 1) AS next_task",
        "FROM projects AS project",
        "LEFT JOIN threads AS thread ON thread.project_id = project.id AND thread.archived_at IS NULL",
        "LEFT JOIN tasks AS task ON task.project_id = project.id",
        "WHERE project.archived_at IS NULL AND project.status <> 'archived'",
        "GROUP BY project.id",
        "ORDER BY project.updated_at DESC, project.id",
        "LIMIT $1",
      ].join("\n"),
      [limit],
    );
    return result.rows.map((row) => ({
      ...mapProject(row),
      threadCount: row.thread_count,
      openTaskCount: row.open_task_count,
      nextTask: row.next_task,
    }));
  }

  public async findProject(id: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      [
        "SELECT id, name, description, status, created_at, updated_at",
        "FROM projects WHERE id = $1 AND archived_at IS NULL AND status <> 'archived'",
      ].join("\n"),
      [id],
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  public async getWorkspace(id: string): Promise<ProjectWorkspace | null> {
    const project = await this.findProject(id);
    if (!project) return null;
    const [tasks, threads] = await Promise.all([this.listTasks(id), this.listThreads(id)]);
    return { project, tasks, threads };
  }

  public async createProject(input: ProjectDraft): Promise<Project> {
    const result = await this.pool.query<ProjectRow>(
      [
        "INSERT INTO projects (name, description, status)",
        "VALUES ($1, $2, $3)",
        "RETURNING id, name, description, status, created_at, updated_at",
      ].join("\n"),
      [input.name, input.description, input.status],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to create the project.");
    return mapProject(row);
  }

  public async updateProject(id: string, input: ProjectDraft): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      [
        "UPDATE projects SET name = $2, description = $3, status = $4, updated_at = now()",
        "WHERE id = $1 AND archived_at IS NULL AND status <> 'archived'",
        "RETURNING id, name, description, status, created_at, updated_at",
      ].join("\n"),
      [id, input.name, input.description, input.status],
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  public async archiveProject(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        [
          "UPDATE projects SET status = 'archived', archived_at = now(), updated_at = now()",
          "WHERE id = $1 AND archived_at IS NULL RETURNING id",
        ].join("\n"),
        [id],
      );
      if (result.rowCount === 1) {
        await client.query(
          [
            "UPDATE threads SET project_id = NULL, kind = 'temporary', updated_at = now()",
            "WHERE project_id = $1",
          ].join("\n"),
          [id],
        );
      }
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async linkThread(projectId: string, threadId: string): Promise<boolean> {
    const result = await this.pool.query(
      [
        "UPDATE threads SET project_id = $1, kind = 'project', updated_at = now()",
        "WHERE id = $2 AND archived_at IS NULL",
        "  AND EXISTS (SELECT 1 FROM projects WHERE id = $1 AND archived_at IS NULL",
        "    AND status <> 'archived')",
      ].join("\n"),
      [projectId, threadId],
    );
    return result.rowCount === 1;
  }

  public async unlinkThread(projectId: string, threadId: string): Promise<boolean> {
    const result = await this.pool.query(
      [
        "UPDATE threads SET project_id = NULL, kind = 'temporary', updated_at = now()",
        "WHERE id = $2 AND project_id = $1 AND archived_at IS NULL",
      ].join("\n"),
      [projectId, threadId],
    );
    return result.rowCount === 1;
  }

  public async findContextForThread(threadId: string): Promise<ProjectContextState | null> {
    const projectResult = await this.pool.query<ProjectRow>(
      [
        "SELECT project.id, project.name, project.description, project.status,",
        "  project.created_at, project.updated_at",
        "FROM threads AS thread",
        "JOIN projects AS project ON project.id = thread.project_id",
        "WHERE thread.id = $1 AND thread.archived_at IS NULL",
        "  AND project.archived_at IS NULL AND project.status <> 'archived'",
      ].join("\n"),
      [threadId],
    );
    const row = projectResult.rows[0];
    if (!row) return null;
    return { project: mapProject(row), tasks: await this.listTasks(row.id, 24) };
  }

  public async createTask(projectId: string, input: ProjectTaskDraft): Promise<ProjectTask | null> {
    const result = await this.pool.query<ProjectTaskRow>(
      [
        `INSERT INTO tasks (project_id, title, description, status, priority, due_at)
         SELECT project.id, $2, $3, $4, $5, $6
         FROM projects AS project
         WHERE project.id = $1 AND project.archived_at IS NULL AND project.status <> 'archived'
         RETURNING ${taskColumns}`,
      ].join("\n"),
      [projectId, input.title, input.description, input.status, input.priority, input.dueAt],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.touchProject(projectId);
    return mapTask(row);
  }

  public async updateTask(id: string, input: ProjectTaskDraft): Promise<ProjectTask | null> {
    const result = await this.pool.query<ProjectTaskRow>(
      [
        "UPDATE tasks SET title = $2, description = $3, status = $4, priority = $5,",
        "  due_at = $6, completed_at = CASE",
        "    WHEN $4 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END,",
        "  updated_at = now()",
        "WHERE id = $1 AND EXISTS (",
        "  SELECT 1 FROM projects AS project",
        "  WHERE project.id = tasks.project_id AND project.archived_at IS NULL",
        "    AND project.status <> 'archived'",
        ")",
        `RETURNING ${taskColumns}`,
      ].join("\n"),
      [id, input.title, input.description, input.status, input.priority, input.dueAt],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.touchProject(row.project_id);
    return mapTask(row);
  }

  public async findTask(id: string): Promise<ProjectTask | null> {
    const result = await this.pool.query<ProjectTaskRow>(
      [
        `SELECT ${taskColumns} FROM tasks`,
        "WHERE id = $1 AND EXISTS (",
        "  SELECT 1 FROM projects AS project",
        "  WHERE project.id = tasks.project_id AND project.archived_at IS NULL",
        "    AND project.status <> 'archived'",
        ")",
      ].join("\n"),
      [id],
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  private async listTasks(projectId: string, limit = 200): Promise<ProjectTask[]> {
    const result = await this.pool.query<ProjectTaskRow>(
      [
        `SELECT ${taskColumns} FROM tasks WHERE project_id = $1`,
        "ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'ready' THEN 1",
        "  WHEN 'blocked' THEN 2 WHEN 'review' THEN 3 WHEN 'backlog' THEN 4",
        "  WHEN 'done' THEN 5 ELSE 6 END, priority DESC, updated_at DESC",
        "LIMIT $2",
      ].join("\n"),
      [projectId, limit],
    );
    return result.rows.map(mapTask);
  }

  private async listThreads(projectId: string): Promise<ThreadSummary[]> {
    const result = await this.pool.query<ProjectThreadRow>(
      [
        "SELECT thread.id, thread.title, thread.kind, thread.project_id,",
        "  thread.created_at, thread.updated_at,",
        "  COUNT(message.id)::int AS message_count,",
        "  (SELECT LEFT(latest.content, 160) FROM messages AS latest",
        "   WHERE latest.thread_id = thread.id",
        "   ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1) AS last_message_preview",
        "FROM threads AS thread",
        "LEFT JOIN messages AS message ON message.thread_id = thread.id",
        "WHERE thread.project_id = $1 AND thread.archived_at IS NULL",
        "GROUP BY thread.id",
        "ORDER BY thread.updated_at DESC, thread.id",
      ].join("\n"),
      [projectId],
    );
    return result.rows.map(mapThread);
  }

  private async touchProject(projectId: string): Promise<void> {
    await this.pool.query("UPDATE projects SET updated_at = now() WHERE id = $1", [projectId]);
  }
}
