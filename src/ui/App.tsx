import { useEffect, useRef, useState } from "react";
import type { ActivityItem, HomeState, Message } from "../core/chat/types.js";
import { loadHome, streamChat } from "./api.js";
import { ActivityRail } from "./components/ActivityRail.js";
import { Brain } from "./components/Brain.js";
import { Conversation } from "./components/Conversation.js";

export function App() {
  const [home, setHome] = useState<HomeState | null>(null);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHome()
      .then(setHome)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "The local service is not ready.");
      });
  }, []);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isThinking) return;

    setDraft("");
    setError(null);
    setIsThinking(true);
    setStreamingText("");

    try {
      await streamChat(
        { ...(home?.thread.id ? { threadId: home.thread.id } : {}), content },
        (event) => {
          if (event.type === "thread") {
            setHome((current) => ({
              thread: event.thread,
              messages: current?.messages ?? [],
              activity: current?.activity ?? [],
              personalisation: current?.personalisation ?? {
                ownerDisplayName: null,
                assistantDisplayName: null,
              },
            }));
          }
          if (event.type === "user_message") {
            setHome((current) =>
              current ? { ...current, messages: [...current.messages, event.message] } : current,
            );
          }
          if (event.type === "delta") {
            setStreamingText((current) => current + event.text);
          }
          if (event.type === "assistant_message") {
            setHome((current) =>
              current
                ? { ...current, messages: [...current.messages, event.message as Message] }
                : current,
            );
            setStreamingText("");
          }
          if (event.type === "error") {
            setError(event.message);
          }
        },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The response failed.");
    } finally {
      setIsThinking(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function reviewActivity(item: ActivityItem) {
    setDraft(`Let’s review “${item.title}”. `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const hasConversation = Boolean(home?.messages.length || streamingText);
  const assistantDisplayName = home?.personalisation.assistantDisplayName || "Local mind";
  const ownerDisplayName = home?.personalisation.ownerDisplayName;

  return (
    <main className="shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="system-bar">
        <div className="system-mark">
          <span className="system-mark__pulse" />
          <span>{assistantDisplayName}</span>
        </div>
        <div className="system-state">{isThinking ? "thinking" : "present"}</div>
      </header>

      <section className={`mind-space ${hasConversation ? "mind-space--active" : ""}`}>
        <Brain listening={isThinking} />
        {!hasConversation ? (
          <div className="resting-copy">
            <p>{ownerDisplayName ? `I’m here, ${ownerDisplayName}.` : "I’m here."}</p>
          </div>
        ) : null}
        <Conversation messages={home?.messages ?? []} streamingText={streamingText} />

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
            disabled={isThinking}
          />
          <button
            className="send-button"
            type="button"
            onClick={() => void sendMessage()}
            disabled={!draft.trim() || isThinking}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 14-7-4 14-3-5-7-2Z" />
            </svg>
          </button>
        </div>
        {error ? <p className="error-note">{error}</p> : null}
      </section>

      <ActivityRail items={home?.activity ?? []} onReview={reviewActivity} />
    </main>
  );
}
