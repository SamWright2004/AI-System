import { describe, expect, it } from "vitest";
import type { Message, MessagePageCursor, Thread } from "../src/core/chat/types.js";
import { ContextAssembler } from "../src/core/context/context-assembler.js";
import type {
  ContextHistoryRepository,
  ContextSource,
  TokenEstimator,
} from "../src/core/context/types.js";

const thread: Thread = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Home",
  kind: "primary",
  createdAt: "2026-08-15T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
};

function message(index: number, role: Message["role"], content: string): Message {
  return {
    id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
    threadId: thread.id,
    role,
    content,
    status: "complete",
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    metadata: {},
    createdAt: new Date(Date.UTC(2026, 7, 15, 10, 0, index)).toISOString(),
  };
}

class PagedHistory implements ContextHistoryRepository {
  public constructor(private readonly chronologicalMessages: Message[]) {}

  public async listMessagePage(input: {
    threadId: string;
    limit: number;
    before?: MessagePageCursor;
  }) {
    const newestFirst = [...this.chronologicalMessages].reverse();
    const cursorIndex = input.before
      ? newestFirst.findIndex((candidate) => candidate.id === input.before?.id)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const messages = newestFirst.slice(start, start + input.limit);
    const hasMore = newestFirst.length > start + input.limit;
    const oldest = messages.at(-1);

    return {
      messages,
      nextCursor:
        hasMore && oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null,
    };
  }
}

const exactEstimator: TokenEstimator = {
  id: "exact-test",
  estimateMessage: (candidate) => candidate.content.length,
  estimateBlock: (candidate) => candidate.content.length,
};

describe("ContextAssembler", () => {
  it("walks paginated history and keeps only complete recent turns within budget", async () => {
    const messages = [
      message(1, "user", "1111"),
      message(2, "assistant", "2222"),
      message(3, "user", "3333"),
      message(4, "assistant", "4444"),
      message(5, "user", "55"),
    ];
    const currentMessage = messages[4];
    if (!currentMessage) throw new Error("Missing test message.");

    const assembler = new ContextAssembler(new PagedHistory(messages), {
      inputTokenBudget: 10,
      historyPageSize: 2,
      estimator: exactEstimator,
    });

    const result = await assembler.assemble({ thread, currentMessage });

    expect(result.messages).toEqual([
      { role: "user", content: "3333" },
      { role: "assistant", content: "4444" },
      { role: "user", content: "55" },
    ]);
    expect(result.diagnostics).toMatchObject({
      estimatedTokens: 10,
      history: {
        pagesRead: 2,
        messagesSelected: 3,
        turnsSelected: 1,
        truncated: true,
      },
    });
  });

  it("does not include an orphaned assistant reply when its user turn will not fit", async () => {
    const messages = [
      message(1, "user", "11"),
      message(2, "assistant", "22"),
      message(3, "user", "33"),
    ];
    const currentMessage = messages[2];
    if (!currentMessage) throw new Error("Missing test message.");

    const assembler = new ContextAssembler(new PagedHistory(messages), {
      inputTokenBudget: 4,
      historyPageSize: 10,
      estimator: exactEstimator,
    });

    const result = await assembler.assemble({ thread, currentMessage });

    expect(result.messages).toEqual([{ role: "user", content: "33" }]);
    expect(result.diagnostics.history.incoherentMessagesExcluded).toBe(1);
  });

  it("allocates source blocks by priority after reserving the current message", async () => {
    const currentMessage = message(1, "user", "11");
    const source: ContextSource = {
      id: "test-source",
      async load() {
        return [
          {
            id: "low",
            source: "test-source",
            title: "Low",
            trust: "application",
            priority: 10,
            content: "333",
          },
          {
            id: "high",
            source: "test-source",
            title: "High",
            trust: "owner",
            priority: 100,
            content: "4444",
          },
        ];
      },
    };
    const assembler = new ContextAssembler(new PagedHistory([currentMessage]), {
      inputTokenBudget: 7,
      historyPageSize: 10,
      estimator: exactEstimator,
      sources: [source],
    });

    const result = await assembler.assemble({ thread, currentMessage });

    expect(result.blocks.map((block) => block.id)).toEqual(["high"]);
    expect(result.diagnostics.sources).toMatchObject({
      candidates: 2,
      blocksSelected: 1,
      blocksOmitted: 1,
      selectedSourceIds: ["test-source"],
    });
  });

  it("always preserves the current user message and reports an over-budget input", async () => {
    const currentMessage = message(1, "user", "12345678");
    const assembler = new ContextAssembler(new PagedHistory([currentMessage]), {
      inputTokenBudget: 5,
      historyPageSize: 10,
      estimator: exactEstimator,
    });

    const result = await assembler.assemble({ thread, currentMessage });

    expect(result.messages).toEqual([{ role: "user", content: "12345678" }]);
    expect(result.diagnostics.overBudget).toBe(true);
    expect(result.diagnostics.history.pagesRead).toBe(0);
  });
});
