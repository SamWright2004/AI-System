import { useMemo, useState, type FormEvent } from "react";
import type { ThreadSummary } from "../../core/chat/types.js";

function relativeTime(timestamp: string): string {
  const milliseconds = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(timestamp),
  );
}

export function HistoryPanel({
  threads,
  activeThreadId,
  onNew,
  onOpen,
  onRename,
  onArchive,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onNew: () => void;
  onOpen: (threadId: string) => Promise<void>;
  onRename: (threadId: string, title: string) => Promise<void>;
  onArchive: (threadId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(
      (thread) =>
        thread.title.toLowerCase().includes(needle) ||
        thread.lastMessagePreview?.toLowerCase().includes(needle),
    );
  }, [query, threads]);

  async function submitRename(event: FormEvent, threadId: string) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setBusyId(threadId);
    setActionError(null);
    try {
      await onRename(threadId, nextTitle);
      setEditingId(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The conversation could not be renamed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function archive(thread: ThreadSummary) {
    if (!window.confirm(`Archive “${thread.title}”? Its messages stay in the database.`)) return;

    setBusyId(thread.id);
    setActionError(null);
    try {
      await onArchive(thread.id);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The conversation could not be archived.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function open(threadId: string) {
    setBusyId(threadId);
    setActionError(null);
    try {
      await onOpen(threadId);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The conversation could not be opened.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="history-panel" aria-label="Conversation history">
      <button className="new-chat-button" type="button" onClick={onNew}>
        <span aria-hidden="true">＋</span>
        Fresh conversation
      </button>

      <label className="history-search">
        <span className="sr-only">Search conversations</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
        />
      </label>

      {actionError ? (
        <p className="panel-error" role="status">
          {actionError}
        </p>
      ) : null}

      <div className="history-list">
        {filtered.length === 0 ? (
          <p className="panel-empty">
            {threads.length ? "No matching conversations." : "No history yet."}
          </p>
        ) : null}

        {filtered.map((thread) => (
          <article
            className={`history-item ${thread.id === activeThreadId ? "history-item--active" : ""}`}
            key={thread.id}
          >
            {editingId === thread.id ? (
              <form
                className="history-item__rename"
                onSubmit={(event) => void submitRename(event, thread.id)}
              >
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  disabled={busyId === thread.id}
                />
                <button type="submit" disabled={busyId === thread.id}>
                  {busyId === thread.id ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={busyId === thread.id}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  className="history-item__open"
                  type="button"
                  onClick={() => void open(thread.id)}
                  disabled={busyId === thread.id}
                >
                  <span className="history-item__title">{thread.title}</span>
                  <span className="history-item__preview">
                    {thread.lastMessagePreview || "Empty conversation"}
                  </span>
                  <span className="history-item__meta">
                    {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
                    <span aria-hidden="true"> · </span>
                    {relativeTime(thread.updatedAt)}
                  </span>
                </button>
                <div className="history-item__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(thread.id);
                      setTitle(thread.title);
                    }}
                    aria-label={`Rename ${thread.title}`}
                    disabled={busyId === thread.id}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void archive(thread)}
                    aria-label={`Archive ${thread.title}`}
                    disabled={busyId === thread.id}
                  >
                    {busyId === thread.id ? "Working…" : "Archive"}
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
