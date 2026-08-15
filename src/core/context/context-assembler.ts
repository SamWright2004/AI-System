import type { Message, MessagePageCursor } from "../chat/types.js";
import { Utf8HeuristicTokenEstimator } from "./token-estimator.js";
import type {
  AssembledContext,
  ContextCandidate,
  ContextHistoryRepository,
  ContextSource,
  ContextSourceInput,
  ConversationContextAssembler,
  TokenEstimator,
} from "./types.js";

export interface ContextAssemblerOptions {
  inputTokenBudget: number;
  historyPageSize: number;
  sources?: ReadonlyArray<ContextSource>;
  estimator?: TokenEstimator;
}

interface RankedCandidate {
  candidate: ContextCandidate;
  sourceIndex: number;
  candidateIndex: number;
}

export class ContextAssembler implements ConversationContextAssembler {
  private readonly sources: ReadonlyArray<ContextSource>;
  private readonly estimator: TokenEstimator;

  public constructor(
    private readonly history: ContextHistoryRepository,
    private readonly options: ContextAssemblerOptions,
  ) {
    if (!Number.isInteger(options.inputTokenBudget) || options.inputTokenBudget < 1) {
      throw new Error("Context input token budget must be a positive integer.");
    }

    if (!Number.isInteger(options.historyPageSize) || options.historyPageSize < 1) {
      throw new Error("Context history page size must be a positive integer.");
    }

    this.sources = options.sources ?? [];
    this.estimator = options.estimator ?? new Utf8HeuristicTokenEstimator();
  }

  public async assemble(input: ContextSourceInput): Promise<AssembledContext> {
    if (input.currentMessage.role !== "user") {
      throw new Error("The current context message must have the user role.");
    }

    const budgetTokens = this.options.inputTokenBudget;
    const currentMessage = {
      role: input.currentMessage.role,
      content: input.currentMessage.content,
    } satisfies Pick<Message, "role" | "content">;
    let estimatedTokens = this.estimator.estimateMessage(currentMessage);

    const loadedSources = await Promise.all(
      this.sources.map(async (source, sourceIndex) => {
        const candidates = await source.load({
          thread: input.thread,
          currentMessage: input.currentMessage,
          ...(input.signal ? { signal: input.signal } : {}),
        });

        return candidates.map(
          (candidate, candidateIndex): RankedCandidate => ({
            candidate,
            sourceIndex,
            candidateIndex,
          }),
        );
      }),
    );

    const rankedCandidates = loadedSources
      .flat()
      .sort(
        (left, right) =>
          right.candidate.priority - left.candidate.priority ||
          left.sourceIndex - right.sourceIndex ||
          left.candidateIndex - right.candidateIndex,
      );
    const selectedBlocks: ContextCandidate[] = [];
    let omittedBlocks = 0;

    for (const ranked of rankedCandidates) {
      const blockTokens = this.estimator.estimateBlock(ranked.candidate);
      if (estimatedTokens + blockTokens > budgetTokens) {
        omittedBlocks += 1;
        continue;
      }

      selectedBlocks.push(ranked.candidate);
      estimatedTokens += blockTokens;
    }

    const selectedOlderNewestFirst: Message[] = [];
    let pendingTurnNewestFirst: Message[] = [];
    let pendingTurnTokens = 0;
    // Anchor the request to the just-persisted user message. A concurrent,
    // later message must never leak backwards into this response's context.
    let before: MessagePageCursor = {
      createdAt: input.currentMessage.createdAt,
      id: input.currentMessage.id,
    };
    let pagesRead = 0;
    let messagesConsidered = 1;
    let turnsSelected = 0;
    let failedMessagesExcluded = 0;
    let incoherentMessagesExcluded = 0;
    let truncated = estimatedTokens >= budgetTokens;
    let stoppedForBudget = estimatedTokens >= budgetTokens;

    while (!stoppedForBudget) {
      const page = await this.history.listMessagePage({
        threadId: input.thread.id,
        limit: this.options.historyPageSize,
        before,
      });
      pagesRead += 1;

      for (const message of page.messages) {
        messagesConsidered += 1;
        if (message.status === "failed") {
          failedMessagesExcluded += 1;
          continue;
        }

        const messageTokens = this.estimator.estimateMessage(message);
        if (message.role === "assistant") {
          pendingTurnNewestFirst.push(message);
          pendingTurnTokens += messageTokens;

          if (estimatedTokens + pendingTurnTokens > budgetTokens) {
            truncated = true;
            stoppedForBudget = true;
            break;
          }
          continue;
        }

        const completeTurnTokens = pendingTurnTokens + messageTokens;
        if (estimatedTokens + completeTurnTokens > budgetTokens) {
          truncated = true;
          stoppedForBudget = true;
          break;
        }

        selectedOlderNewestFirst.push(...pendingTurnNewestFirst, message);
        estimatedTokens += completeTurnTokens;
        turnsSelected += 1;
        pendingTurnNewestFirst = [];
        pendingTurnTokens = 0;
      }

      if (stoppedForBudget) break;

      if (!page.nextCursor) {
        incoherentMessagesExcluded += pendingTurnNewestFirst.length;
        break;
      }

      before = page.nextCursor;
    }

    if (stoppedForBudget) {
      incoherentMessagesExcluded += pendingTurnNewestFirst.length;
    }

    const messages = [
      ...selectedOlderNewestFirst.reverse().map((message) => ({
        role: message.role,
        content: message.content,
      })),
      currentMessage,
    ];

    return {
      messages,
      blocks: selectedBlocks.map(({ id, source, title, trust, content }) => ({
        id,
        source,
        title,
        trust,
        content,
      })),
      diagnostics: {
        version: 1,
        estimator: this.estimator.id,
        budgetTokens,
        estimatedTokens,
        remainingTokens: Math.max(0, budgetTokens - estimatedTokens),
        overBudget: estimatedTokens > budgetTokens,
        history: {
          pageSize: this.options.historyPageSize,
          pagesRead,
          messagesConsidered,
          messagesSelected: messages.length,
          turnsSelected,
          failedMessagesExcluded,
          incoherentMessagesExcluded,
          truncated,
        },
        sources: {
          candidates: rankedCandidates.length,
          blocksSelected: selectedBlocks.length,
          blocksOmitted: omittedBlocks,
          selectedSourceIds: [...new Set(selectedBlocks.map((block) => block.source))],
        },
      },
    };
  }
}
