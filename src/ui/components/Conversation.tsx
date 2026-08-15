import { useEffect, useRef, useState } from "react";
import type { Message } from "../../core/chat/types.js";

export function Conversation({
  messages,
  streamingText,
}: {
  messages: Message[];
  streamingText: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText]);

  if (messages.length === 0 && !streamingText) return null;

  return (
    <div className="conversation" aria-live="polite">
      {messages.map((message) => (
        <article className={`message message--${message.role}`} key={message.id}>
          <p>{message.content}</p>
          <footer className="message__footer">
            {message.status !== "complete" ? (
              <span>{message.status === "cancelled" ? "Stopped" : "Interrupted"}</span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(message.content)
                  .then(() => {
                    setCopiedId(message.id);
                    window.setTimeout(() => setCopiedId(null), 1_200);
                  })
                  .catch(() => undefined);
              }}
            >
              {copiedId === message.id ? "Copied" : "Copy"}
            </button>
          </footer>
        </article>
      ))}
      {streamingText ? (
        <article className="message message--assistant message--streaming">
          <p>{streamingText}</p>
        </article>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
