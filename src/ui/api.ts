import type { ChatStreamEvent, HomeState, Thread, ThreadState } from "../core/chat/types.js";
import type { PersonalisationProfile } from "../core/settings/types.js";

interface ApiErrorBody {
  message?: string;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.message || "The local service could not complete that request.");
  }
  return (await response.json()) as T;
}

export async function loadHome(): Promise<HomeState> {
  return apiJson<HomeState>("/api/v1/bootstrap");
}

export async function loadThread(threadId: string): Promise<ThreadState> {
  return apiJson<ThreadState>(`/api/v1/threads/${threadId}`);
}

async function streamRequest(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const errorBody = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(errorBody.message || "The message could not be sent.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (data) {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }
}

export async function streamChat(
  input: { threadId?: string; content: string },
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  return streamRequest("/api/v1/chat/stream", input, signal, onEvent);
}

export async function retryChat(
  input: { threadId: string; userMessageId: string },
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  return streamRequest("/api/v1/chat/retry", input, signal, onEvent);
}

export async function renameThread(threadId: string, title: string): Promise<Thread> {
  return apiJson<Thread>(`/api/v1/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function archiveThread(threadId: string): Promise<void> {
  const response = await fetch(`/api/v1/threads/${threadId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error("The conversation could not be archived.");
  }
}

export async function savePersonalisation(
  profile: PersonalisationProfile,
): Promise<PersonalisationProfile> {
  return apiJson<PersonalisationProfile>("/api/v1/settings/personalisation", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}
