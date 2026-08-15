import type { AssistantGateway, AssistantInput } from "../../core/chat/types.js";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class MockAssistantGateway implements AssistantGateway {
  public readonly provider = "mock";
  public readonly model = "foundation-mode";

  public async *streamReply(input: AssistantInput): AsyncIterable<{ type: "delta"; text: string }> {
    const lastMessage = input.messages.at(-1)?.content ?? "";
    const response =
      "I’m here. The foundation is running locally, and I’ve stored this exchange in your own database. " +
      `For the moment I’m using a mock mind, so I won’t pretend I understood “${lastMessage.slice(0, 90)}” properly. ` +
      "Once you connect a model provider, this same interface will stream real replies without changing the rest of the system.";

    for (const token of response.match(/\S+\s*/g) ?? []) {
      input.signal?.throwIfAborted();
      await wait(18);
      input.signal?.throwIfAborted();
      yield {
        type: "delta",
        text: token,
      };
    }
  }
}
