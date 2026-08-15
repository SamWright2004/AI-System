import type {
  ActivityItem,
  ChatStreamEvent,
  HomeState,
  Message,
  Thread,
} from "../core/chat/types.js";

export interface UiState {
  thread: Thread;
  messages: Message[];
  activity: ActivityItem[];
  personalisation: HomeState["personalisation"];
}

export async function loadHome(): Promise<HomeState> {
  const response = await fetch("/api/v1/bootstrap");
  if (!response.ok) {
    throw new Error("The local service is not ready.");
  }
  return (await response.json()) as HomeState;
}

export async function streamChat(
  input: { threadId?: string; content: string },
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const response = await fetch("/api/v1/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok || !response.body) {
    throw new Error("The message could not be sent.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

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
