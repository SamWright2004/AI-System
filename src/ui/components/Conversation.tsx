import { useEffect, useRef } from "react";
import type { Message } from "../../core/chat/types.js";

export function Conversation({
  messages,
  streamingText,
}: {
  messages: Message[];
  streamingText: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText]);

  if (messages.length === 0 && !streamingText) return null;

  return (
    <div className="conversation" aria-live="polite">
      {messages.map((message) => (
        <article className={`message message--${message.role}`} key={message.id}>
          <p>{message.content}</p>
          {message.status === "failed" ? <span>Interrupted</span> : null}
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
