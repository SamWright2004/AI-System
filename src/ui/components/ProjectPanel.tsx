import { useState, type FormEvent } from "react";
import type {
  Project,
  ProjectDraft,
  ProjectSummary,
  ProjectTask,
  ProjectTaskDraft,
  ProjectWorkspace,
} from "../../core/projects/types.js";
import { projectStatuses, taskStatuses } from "../../core/projects/types.js";

const blankProject: ProjectDraft = { name: "", description: "", status: "active" };

function taskDraft(task: ProjectTask): ProjectTaskDraft {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
  };
}

export function ProjectPanel({
  projects,
  workspace,
  activeThreadId,
  activeProjectId,
  onOpen,
  onOpenThread,
  onCreate,
  onUpdate,
  onArchive,
  onStartConversation,
  onLinkThread,
  onUnlinkThread,
  onCreateTask,
  onUpdateTask,
}: {
  projects: ProjectSummary[];
  workspace: ProjectWorkspace | null;
  activeThreadId: string | null;
  activeProjectId: string | null;
  onOpen: (id: string) => Promise<void>;
  onOpenThread: (id: string) => Promise<void>;
  onCreate: (input: ProjectDraft) => Promise<void>;
  onUpdate: (id: string, input: ProjectDraft) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onStartConversation: (project: Project) => void;
  onLinkThread: (projectId: string, threadId: string) => Promise<void>;
  onUnlinkThread: (projectId: string, threadId: string) => Promise<void>;
  onCreateTask: (projectId: string, input: ProjectTaskDraft) => Promise<void>;
  onUpdateTask: (taskId: string, input: ProjectTaskDraft) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectDraft>(blankProject);
  const [taskTitle, setTaskTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, operation: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    if (!projectForm.name.trim()) return;
    await run("project-form", async () => {
      const draft = {
        ...projectForm,
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
      };
      if (editing && workspace) await onUpdate(workspace.project.id, draft);
      else await onCreate(draft);
      setCreating(false);
      setEditing(false);
      setProjectForm(blankProject);
    });
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !taskTitle.trim()) return;
    await run("new-task", async () => {
      await onCreateTask(workspace.project.id, {
        title: taskTitle.trim(),
        description: "",
        status: "ready",
        priority: 50,
        dueAt: null,
      });
      setTaskTitle("");
    });
  }

  function editCurrentProject() {
    if (!workspace) return;
    setProjectForm({
      name: workspace.project.name,
      description: workspace.project.description,
      status: workspace.project.status === "archived" ? "paused" : workspace.project.status,
    });
    setEditing(true);
    setCreating(true);
  }

  return (
    <section className="project-panel" aria-label="Project workspaces">
      <div className="project-panel__intro">
        <strong>Context only when you choose it.</strong>
        <p>
          Projects hold explicit state, tasks and linked conversations without cluttering a fresh
          chat.
        </p>
      </div>

      <button
        className="project-create"
        type="button"
        onClick={() => {
          setEditing(false);
          setProjectForm(blankProject);
          setCreating((current) => !current);
        }}
      >
        {creating && !editing ? "Close project form" : "New project"}
      </button>

      {error ? <p className="panel-error">{error}</p> : null}

      {creating ? (
        <form className="project-form" onSubmit={(event) => void submitProject(event)}>
          <label>
            <span>Name</span>
            <input
              value={projectForm.name}
              onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
              maxLength={120}
              required
            />
          </label>
          <label>
            <span>What this project is trying to achieve</span>
            <textarea
              rows={4}
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm({ ...projectForm, description: event.target.value })
              }
              maxLength={4_000}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={projectForm.status}
              onChange={(event) =>
                setProjectForm({
                  ...projectForm,
                  status: event.target.value as ProjectDraft["status"],
                })
              }
            >
              {projectStatuses
                .filter((status) => status !== "archived")
                .map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
          <footer>
            <button type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" disabled={busy === "project-form" || !projectForm.name.trim()}>
              {busy === "project-form" ? "Saving…" : editing ? "Save project" : "Create project"}
            </button>
          </footer>
        </form>
      ) : null}

      <div className="project-list">
        {projects.length === 0 ? <p className="panel-empty">No projects yet.</p> : null}
        {projects.map((project) => (
          <button
            key={project.id}
            className={workspace?.project.id === project.id ? "is-active" : ""}
            type="button"
            onClick={() => void run("open:" + project.id, () => onOpen(project.id))}
          >
            <span>
              <strong>{project.name}</strong>
              <small>{project.status}</small>
            </span>
            <span>
              {project.openTaskCount} open · {project.threadCount} chats
            </span>
            {project.nextTask ? <em>Next: {project.nextTask}</em> : null}
          </button>
        ))}
      </div>

      {workspace ? (
        <article className="project-workspace">
          <header>
            <div>
              <span>{workspace.project.status}</span>
              <h3>{workspace.project.name}</h3>
            </div>
            <button type="button" onClick={editCurrentProject}>
              Edit
            </button>
          </header>
          {workspace.project.description ? <p>{workspace.project.description}</p> : null}

          <div className="project-actions">
            <button type="button" onClick={() => onStartConversation(workspace.project)}>
              Fresh project chat
            </button>
            {activeThreadId && activeProjectId !== workspace.project.id ? (
              <button
                type="button"
                disabled={busy === "link"}
                onClick={() =>
                  void run("link", () => onLinkThread(workspace.project.id, activeThreadId))
                }
              >
                Move open chat here
              </button>
            ) : null}
            {activeThreadId && activeProjectId === workspace.project.id ? (
              <button
                type="button"
                disabled={busy === "unlink"}
                onClick={() =>
                  void run("unlink", () => onUnlinkThread(workspace.project.id, activeThreadId))
                }
              >
                Detach open chat
              </button>
            ) : null}
          </div>

          <section className="project-tasks">
            <header>
              <h4>Tasks</h4>
              <span>
                {
                  workspace.tasks.filter(
                    (task) => task.status !== "done" && task.status !== "cancelled",
                  ).length
                }{" "}
                open
              </span>
            </header>
            <form onSubmit={(event) => void addTask(event)}>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Add the next useful task"
                maxLength={240}
              />
              <button type="submit" disabled={!taskTitle.trim() || busy === "new-task"}>
                Add
              </button>
            </form>
            {workspace.tasks.map((task) => (
              <div key={task.id} className={`project-task project-task--${task.status}`}>
                <span>{task.title}</span>
                <select
                  aria-label={`Status for ${task.title}`}
                  value={task.status}
                  disabled={busy === task.id}
                  onChange={(event) =>
                    void run(task.id, () =>
                      onUpdateTask(task.id, {
                        ...taskDraft(task),
                        status: event.target.value as ProjectTask["status"],
                      }),
                    )
                  }
                >
                  {taskStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </section>

          <section className="project-threads">
            <header>
              <h4>Conversations</h4>
              <span>{workspace.threads.length}</span>
            </header>
            {workspace.threads.length === 0 ? (
              <p>No conversations are linked yet.</p>
            ) : (
              workspace.threads.map((thread) => (
                <button key={thread.id} type="button" onClick={() => void onOpenThread(thread.id)}>
                  <span>{thread.title}</span>
                  <small>{thread.messageCount} messages</small>
                </button>
              ))
            )}
          </section>

          <button
            className="project-archive"
            type="button"
            onClick={() => {
              if (window.confirm("Archive this project? Its conversations stay in history.")) {
                void run("archive", () => onArchive(workspace.project.id));
              }
            }}
          >
            Archive project
          </button>
        </article>
      ) : null}
    </section>
  );
}
