import { useEffect, useRef, useState } from "react";
import type {
  ActivityItem,
  ChatStreamEvent,
  GenerationProblem,
  HomeState,
  Message,
  Thread,
  ThreadSummary,
} from "../core/chat/types.js";
import type { PersonalisationProfile } from "../core/settings/types.js";
import {
  archiveThread,
  loadHome,
  loadThread,
  renameThread,
  retryChat,
  savePersonalisation,
  streamChat,
} from "./api.js";
import { ActivityRail } from "./components/ActivityRail.js";
import { Brain } from "./components/Brain.js";
import { Conversation } from "./components/Conversation.js";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";

type UtilityPanel = "history" | "activity" | "settings" | null;
type GenerationState = "idle" | "thinking" | "stopping";

function appendUnique(messages: Message[], message: Message): Message[] {
  return messages.some((candidate) => candidate.id === message.id)
    ? messages
    : [...messages, message];
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "conversation"
  );
}

export function App() {
  const [home, setHome] = useState<HomeState | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [problem, setProblem] = useState<GenerationProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<UtilityPanel>(null);
  const [sendOnEnter, setSendOnEnter] = useState(
    () => window.localStorage.getItem("personal-ai.send-on-enter") !== "false",
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeThreadRef = useRef<Thread | null>(null);
  const streamingTextRef = useRef("");
  const lastUserMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadHome()
      .then(setHome)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "The local service is not ready.");
      });
  }, []);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  useEffect(() => {
    window.localStorage.setItem("personal-ai.send-on-enter", String(sendOnEnter));
  }, [sendOnEnter]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel("history");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setPanel("settings");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!abortRef.current) {
          setActiveThread(null);
          setMessages([]);
          setStreamingText("");
          setProblem(null);
          setError(null);
          setPanel(null);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
      if (event.key === "Escape") {
        if (abortRef.current) {
          abortRef.current.abort();
          setGenerationState("stopping");
        } else {
          setPanel(null);
        }
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  async function refreshHome() {
    const next = await loadHome();
    setHome(next);
  }

  function startFreshConversation() {
    if (abortRef.current) return;
    setActiveThread(null);
    setMessages([]);
    setStreamingText("");
    setProblem(null);
    setError(null);
    setPanel(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function openConversation(threadId: string) {
    if (abortRef.current) return;
    setError(null);
    const state = await loadThread(threadId);
    setActiveThread(state.thread);
    setMessages(state.messages);
    setStreamingText("");
    setProblem(null);
    setPanel(null);
    lastUserMessageIdRef.current =
      [...state.messages].reverse().find((message) => message.role === "user")?.id ?? null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleStreamEvent(event: ChatStreamEvent) {
    if (event.type === "thread") {
      setActiveThread(event.thread);
      activeThreadRef.current = event.thread;
      setHome((current) => {
        if (!current) return current;
        const existing = current.threads.find((thread) => thread.id === event.thread.id);
        const summary: ThreadSummary = {
          ...event.thread,
          messageCount: existing?.messageCount ?? 0,
          lastMessagePreview: existing?.lastMessagePreview ?? null,
        };
        return {
          ...current,
          threads: [summary, ...current.threads.filter((thread) => thread.id !== summary.id)],
        };
      });
    }
    if (event.type === "user_message") {
      lastUserMessageIdRef.current = event.message.id;
      setMessages((current) => appendUnique(current, event.message));
    }
    if (event.type === "delta") {
      setStreamingText((current) => {
        const next = current + event.text;
        streamingTextRef.current = next;
        return next;
      });
    }
    if (event.type === "assistant_message") {
      setMessages((current) => appendUnique(current, event.message));
      setStreamingText("");
      streamingTextRef.current = "";
      setProblem(null);
    }
    if (event.type === "cancelled" || event.type === "error") {
      if (event.message) {
        setMessages((current) => appendUnique(current, event.message as Message));
        setStreamingText("");
        streamingTextRef.current = "";
      }
      setProblem(event);
    }
  }

  async function syncAfterAbort() {
    const thread = activeThreadRef.current;
    if (!thread) return;

    try {
      let state = await loadThread(thread.id);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const lastMessage = state.messages.at(-1);
        if (
          lastMessage?.role === "assistant" &&
          (lastMessage.status === "cancelled" || lastMessage.status === "failed")
        ) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 140));
        state = await loadThread(thread.id);
      }
      setActiveThread(state.thread);
      setMessages(state.messages);
      setStreamingText("");
      const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
      const lastMessage = state.messages.at(-1);
      const partial =
        lastMessage?.role === "assistant" &&
        (lastMessage.status === "cancelled" || lastMessage.status === "failed");
      setProblem({
        code: "CANCELLED",
        message: partial ? "Stopped. I kept the partial reply." : "Stopped before I replied.",
        retryable: !partial,
        userMessageId: lastUser?.id ?? lastUserMessageIdRef.current,
        partial,
      });
    } catch {
      setStreamingText("");
      setProblem({
        code: "CANCELLED",
        message: "Stopped.",
        retryable: false,
        userMessageId: lastUserMessageIdRef.current,
        partial: Boolean(streamingTextRef.current.trim()),
      });
    }
  }

  async function runGeneration(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    setProblem(null);
    setError(null);
    setGenerationState("thinking");
    setStreamingText("");
    streamingTextRef.current = "";

    try {
      await operation(controller.signal);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") {
        await syncAfterAbort();
      } else {
        setError(reason instanceof Error ? reason.message : "The response failed.");
      }
    } finally {
      abortRef.current = null;
      setGenerationState("idle");
      await refreshHome().catch(() => undefined);
      inputRef.current?.focus();
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || abortRef.current) return;

    setDraft("");
    await runGeneration((signal) =>
      streamChat(
        {
          ...(activeThreadRef.current?.id ? { threadId: activeThreadRef.current.id } : {}),
          content,
        },
        signal,
        handleStreamEvent,
      ),
    );
  }

  async function retryLastMessage() {
    const threadId = activeThreadRef.current?.id;
    const userMessageId = problem?.userMessageId;
    if (!threadId || !userMessageId || !problem.retryable || abortRef.current) return;

    await runGeneration((signal) =>
      retryChat({ threadId, userMessageId }, signal, handleStreamEvent),
    );
  }

  function stopGeneration() {
    if (!abortRef.current) return;
    setGenerationState("stopping");
    abortRef.current.abort();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const shouldSend =
      event.key === "Enter" &&
      !abortRef.current &&
      ((sendOnEnter && !event.shiftKey) || (!sendOnEnter && (event.ctrlKey || event.metaKey)));
    if (shouldSend) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function updateConversationTitle(threadId: string, title: string) {
    const updated = await renameThread(threadId, title);
    setActiveThread((current) => (current?.id === updated.id ? updated : current));
    await refreshHome();
  }

  async function archiveConversation(threadId: string) {
    await archiveThread(threadId);
    if (activeThreadRef.current?.id === threadId) {
      startFreshConversation();
    }
    await refreshHome();
  }

  async function updatePersonalisation(profile: PersonalisationProfile) {
    const updated = await savePersonalisation(profile);
    setHome((current) => (current ? { ...current, personalisation: updated } : current));
    setError(null);
  }

  function reviewActivity(item: ActivityItem) {
    setDraft(`Let’s review “${item.title}”. `);
    setPanel(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function exportConversation(format: "markdown" | "json") {
    if (!activeThread) return;
    const basename = safeFilename(activeThread.title);
    if (format === "json") {
      download(
        `${basename}.json`,
        `${JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            thread: activeThread,
            messages,
          },
          null,
          2,
        )}\n`,
        "application/json",
      );
      return;
    }

    const assistantName = home?.personalisation.assistant.displayName || "Assistant";
    const ownerName = home?.personalisation.owner.displayName || "You";
    const markdown = [
      `# ${activeThread.title}`,
      "",
      `_Exported ${new Date().toLocaleString("en-GB")}._`,
      "",
      ...messages.flatMap((message) => [
        `## ${message.role === "user" ? ownerName : assistantName}`,
        "",
        message.content,
        "",
      ]),
    ].join("\n");
    download(`${basename}.md`, markdown, "text/markdown");
  }

  const hasConversation = Boolean(messages.length || streamingText);
  const assistantDisplayName = home?.personalisation.assistant.displayName || "Local mind";
  const ownerDisplayName = home?.personalisation.owner.displayName;
  const isGenerating = generationState !== "idle";

  return (
    <main className="shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="system-bar">
        <div className="system-bar__side">
          <button
            className="system-action"
            type="button"
            onClick={() => setPanel("history")}
            aria-label="Conversation history"
            title="History (Ctrl+K)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <div className="system-mark">
            <span className="system-mark__pulse" />
            <span>{assistantDisplayName}</span>
          </div>
        </div>

        <div className="system-bar__thread">{activeThread?.title || "Fresh conversation"}</div>

        <div className="system-bar__side system-bar__side--end">
          <span className="system-state">
            {generationState === "thinking"
              ? "thinking"
              : generationState === "stopping"
                ? "stopping"
                : "present"}
          </span>
          <button
            className="system-action"
            type="button"
            onClick={() => setPanel("activity")}
            aria-label="Background activity"
            title="Activity"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 17h3l2-5 3 8 3-13 2 10h3" />
            </svg>
            {home?.activity.length ? <i>{home.activity.length}</i> : null}
          </button>
          <button
            className="system-action"
            type="button"
            onClick={() => setPanel("settings")}
            aria-label="Settings"
            title="Settings (Ctrl+,)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="m19 13.5 1.5 1.2-2 3.4-1.8-.7a7 7 0 0 1-2.2 1.3l-.3 1.9h-4l-.3-1.9a7 7 0 0 1-2.2-1.3l-1.8.7-2-3.4 1.5-1.2a7 7 0 0 1 0-2.6L4 9.7l2-3.4 1.8.7A7 7 0 0 1 10 5.7l.3-1.9h4l.3 1.9A7 7 0 0 1 16.8 7l1.8-.7 2 3.4-1.5 1.2a7 7 0 0 1 0 2.6Z" />
            </svg>
          </button>
        </div>
      </header>

      <section className={`mind-space ${hasConversation ? "mind-space--active" : ""}`}>
        <Brain listening={isGenerating} />

        {!hasConversation ? (
          <div className="resting-copy">
            <p>{ownerDisplayName ? `I’m here, ${ownerDisplayName}.` : "I’m here."}</p>
            <span>A fresh conversation. Your earlier ones are still in history.</span>
          </div>
        ) : null}

        {activeThread && hasConversation ? (
          <div className="conversation-toolbar">
            <span>{activeThread.title}</span>
            <div>
              <button type="button" onClick={() => exportConversation("markdown")}>
                Markdown
              </button>
              <button type="button" onClick={() => exportConversation("json")}>
                JSON
              </button>
            </div>
          </div>
        ) : null}

        <Conversation messages={messages} streamingText={streamingText} />

        <div className="composer-wrap">
          <label className="sr-only" htmlFor="message">
            Speak to your personal AI
          </label>
          <textarea
            ref={inputRef}
            id="message"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Say something…"
            maxLength={32_000}
          />
          {isGenerating ? (
            <button
              className="send-button send-button--stop"
              type="button"
              onClick={stopGeneration}
              aria-label="Stop response"
              title="Stop (Escape)"
            >
              <span />
            </button>
          ) : (
            <button
              className="send-button"
              type="button"
              onClick={() => void sendMessage()}
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12 14-7-4 14-3-5-7-2Z" />
              </svg>
            </button>
          )}
          {draft.length > 28_000 ? (
            <span className="composer-count">{draft.length.toLocaleString()} / 32,000</span>
          ) : null}
        </div>

        {problem || error ? (
          <div className="error-note" role="status">
            <span>{error || problem?.message}</span>
            {problem?.retryable && problem.userMessageId ? (
              <button type="button" onClick={() => void retryLastMessage()}>
                Retry safely
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {panel ? (
        <>
          <button
            className="panel-backdrop"
            type="button"
            onClick={() => setPanel(null)}
            aria-label="Close panel"
          />
          <aside
            className={`utility-drawer utility-drawer--${panel === "history" ? "left" : "right"}`}
          >
            <header className="utility-drawer__header">
              <div>
                <span className="eyebrow">
                  {panel === "history"
                    ? "Conversations"
                    : panel === "settings"
                      ? "Settings"
                      : "Background"}
                </span>
                <h2>
                  {panel === "history"
                    ? "History"
                    : panel === "settings"
                      ? "Make it yours"
                      : "While you were away"}
                </h2>
              </div>
              <button type="button" onClick={() => setPanel(null)} aria-label="Close panel">
                ×
              </button>
            </header>

            {panel === "history" ? (
              <HistoryPanel
                threads={home?.threads ?? []}
                activeThreadId={activeThread?.id ?? null}
                onNew={startFreshConversation}
                onOpen={openConversation}
                onRename={updateConversationTitle}
                onArchive={archiveConversation}
              />
            ) : null}

            {panel === "activity" ? (
              <ActivityRail items={home?.activity ?? []} onReview={reviewActivity} />
            ) : null}

            {panel === "settings" && home ? (
              <SettingsPanel
                profile={home.personalisation}
                runtime={home.runtime}
                sendOnEnter={sendOnEnter}
                onSendOnEnterChange={setSendOnEnter}
                onSave={updatePersonalisation}
              />
            ) : null}
          </aside>
        </>
      ) : null}
    </main>
  );
}
