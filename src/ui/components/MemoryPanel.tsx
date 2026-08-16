import { useMemo, useState, type FormEvent } from "react";
import type {
  MemoryDraft,
  MemoryExtractionSummary,
  MemoryItem,
  MemoryKind,
  MemoryOverview,
} from "../../core/memory/types.js";
import { memoryKinds } from "../../core/memory/types.js";

type MemoryTab = "review" | "active" | "history";

const kindLabels: Record<MemoryKind, string> = {
  fact: "Fact",
  preference: "Preference",
  relationship: "Relationship",
  project: "Project",
  routine: "Routine",
  decision: "Decision",
  working: "Working style",
};

const sensitivityLabels = ["Ordinary", "Personal", "Sensitive", "Highly sensitive"] as const;

const blankMemory: MemoryDraft = {
  kind: "fact",
  subject: "",
  content: "",
  importance: 50,
  sensitivity: 0,
};

function memoryDraft(item: MemoryItem): MemoryDraft {
  return {
    kind: item.kind,
    subject: item.subject,
    content: item.content,
    importance: item.importance,
    sensitivity: item.sensitivity,
  };
}

function MemoryEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: MemoryDraft;
  submitLabel: string;
  onSubmit: (value: MemoryDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.subject.trim() || !form.content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...form,
        subject: form.subject.trim(),
        content: form.content.trim(),
      });
      onCancel();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The memory could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="memory-editor" onSubmit={(event) => void submit(event)}>
      <div className="memory-editor__row">
        <label>
          <span>Kind</span>
          <select
            value={form.kind}
            onChange={(event) =>
              setForm({ ...form, kind: event.target.value as MemoryKind })
            }
          >
            {memoryKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sensitivity</span>
          <select
            value={form.sensitivity}
            onChange={(event) =>
              setForm({ ...form, sensitivity: Number(event.target.value) })
            }
          >
            {sensitivityLabels.map((label, value) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>Subject</span>
        <input
          value={form.subject}
          onChange={(event) => setForm({ ...form, subject: event.target.value })}
          maxLength={120}
          placeholder="A short stable label"
          required
        />
      </label>
      <label>
        <span>What should be remembered</span>
        <textarea
          rows={4}
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          maxLength={1_000}
          required
        />
      </label>
      <label>
        <span>Importance: {form.importance}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={form.importance}
          onChange={(event) => setForm({ ...form, importance: Number(event.target.value) })}
        />
      </label>
      {error ? (
        <p className="panel-error" role="status">
          {error}
        </p>
      ) : null}
      <footer>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !form.subject.trim() || !form.content.trim()}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </footer>
    </form>
  );
}

function MemoryCard({
  item,
  busy,
  onEdit,
  onApprove,
  onReject,
  onForget,
}: {
  item: MemoryItem;
  busy: boolean;
  onEdit: () => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onForget: () => Promise<void>;
}) {
  return (
    <article className={"memory-card memory-card--" + item.status}>
      <header>
        <div>
          <span className="memory-kind">{kindLabels[item.kind]}</span>
          <h3>{item.subject}</h3>
        </div>
        <span className="memory-status">{item.status}</span>
      </header>
      <p className="memory-content">{item.content}</p>
      <div className="memory-metrics">
        <span>{Math.round(item.confidence * 100)}% source confidence</span>
        <span>importance {item.importance}</span>
        <span>{sensitivityLabels[item.sensitivity] ?? "Unknown sensitivity"}</span>
      </div>
      {item.rationale ? (
        <p className="memory-rationale">
          <strong>Why I think this:</strong> {item.rationale}
        </p>
      ) : null}
      {item.source.excerpt ? (
        <blockquote>
          <span>
            {item.source.threadTitle || "Conversation evidence"}
            {item.source.type === "owner_edited_message" ? " · owner-edited proposal" : ""}
          </span>
          {item.source.excerpt}
        </blockquote>
      ) : (
        <p className="memory-source">
          Source: {item.source.type === "owner" ? "added directly by you" : item.source.type}
        </p>
      )}
      <footer>
        {item.status === "proposed" ? (
          <>
            <button type="button" onClick={() => void onApprove()} disabled={busy}>
              Approve
            </button>
            <button type="button" onClick={onEdit} disabled={busy}>
              Edit first
            </button>
            <button type="button" onClick={() => void onReject()} disabled={busy}>
              Reject
            </button>
          </>
        ) : null}
        {item.status === "active" ? (
          <>
            <button type="button" onClick={onEdit} disabled={busy}>
              Revise
            </button>
            <button type="button" onClick={() => void onForget()} disabled={busy}>
              Forget
            </button>
          </>
        ) : null}
        {item.status === "rejected" || item.status === "superseded" ? (
          <button type="button" onClick={() => void onForget()} disabled={busy}>
            Remove record
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export function MemoryPanel({
  overview,
  activeThreadId,
  onScan,
  onCreate,
  onEdit,
  onApprove,
  onReject,
  onForget,
}: {
  overview: MemoryOverview | null;
  activeThreadId: string | null;
  onScan: () => Promise<MemoryExtractionSummary>;
  onCreate: (input: MemoryDraft) => Promise<void>;
  onEdit: (id: string, input: MemoryDraft) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onForget: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<MemoryTab>("review");
  const [editing, setEditing] = useState<MemoryItem | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!overview) return [];
    if (tab === "review") return overview.proposed;
    if (tab === "active") return overview.active;
    return overview.history;
  }, [overview, tab]);

  async function action(id: string, operation: () => Promise<void>) {
    setBusyId(id);
    setActionError(null);
    try {
      await operation();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The memory action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function scan() {
    setScanning(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await onScan();
      setNotice(
        result.created === 0
          ? result.candidates === 0
            ? "I found nothing durable enough to propose."
            : "No new proposals; these claims were already reviewed."
          : result.created === 1
            ? "One proposal is waiting for your review."
            : result.created + " proposals are waiting for your review.",
      );
      if (result.created > 0) setTab("review");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The conversation scan failed.");
    } finally {
      setScanning(false);
    }
  }

  if (!overview) {
    return <p className="panel-empty">Loading memory…</p>;
  }

  return (
    <section className="memory-panel" aria-label="Honest memory">
      <div className="memory-principle">
        <strong>Nothing is remembered silently.</strong>
        <p>
          Extraction creates proposals. Only memories you approve can enter future replies.
        </p>
      </div>

      <div className="memory-tools">
        <button type="button" onClick={() => void scan()} disabled={!activeThreadId || scanning}>
          {scanning ? "Reviewing…" : "Review this conversation"}
        </button>
        <button type="button" onClick={() => setEditing("new")}>
          Add directly
        </button>
      </div>
      {!activeThreadId ? (
        <p className="memory-hint">Open a saved conversation to review it for possible memories.</p>
      ) : null}
      <p className="memory-runtime">
        Extractor: {overview.extractor.provider} / {overview.extractor.model}. Automatic context allows
        sensitivity {overview.contextPolicy.maxSensitivity} or lower.
      </p>

      {notice ? (
        <p className="panel-note" role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p className="panel-error" role="status">
          {actionError}
        </p>
      ) : null}

      {editing === "new" ? (
        <MemoryEditor
          initial={blankMemory}
          submitLabel="Remember this"
          onSubmit={onCreate}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <nav className="memory-tabs" aria-label="Memory status">
        <button
          className={tab === "review" ? "is-active" : ""}
          type="button"
          onClick={() => setTab("review")}
        >
          Review <span>{overview.counts.proposed}</span>
        </button>
        <button
          className={tab === "active" ? "is-active" : ""}
          type="button"
          onClick={() => setTab("active")}
        >
          Remembered <span>{overview.counts.active}</span>
        </button>
        <button
          className={tab === "history" ? "is-active" : ""}
          type="button"
          onClick={() => setTab("history")}
        >
          History <span>{overview.counts.rejected + overview.counts.superseded}</span>
        </button>
      </nav>

      <div className="memory-list">
        {items.length === 0 ? (
          <p className="panel-empty">
            {tab === "review"
              ? "No claims are waiting for review."
              : tab === "active"
                ? "No approved memories yet."
                : "No rejected or superseded memories."}
          </p>
        ) : null}

        {items.map((item) =>
          editing && editing !== "new" && editing.id === item.id ? (
            <MemoryEditor
              key={item.id}
              initial={memoryDraft(item)}
              submitLabel={item.status === "active" ? "Save as revision" : "Save proposal"}
              onSubmit={(input) => onEdit(item.id, input)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <MemoryCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onEdit={() => setEditing(item)}
              onApprove={() => action(item.id, () => onApprove(item.id))}
              onReject={() => action(item.id, () => onReject(item.id))}
              onForget={() =>
                action(item.id, async () => {
                  if (
                    !window.confirm(
                      "Forget this derived memory? The original conversation remains in history.",
                    )
                  ) {
                    return;
                  }
                  await onForget(item.id);
                })
              }
            />
          ),
        )}
      </div>
    </section>
  );
}
