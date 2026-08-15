import type {
  AssistantContextBlock,
  Message,
  MessagePage,
  MessagePageCursor,
  Thread,
} from "../chat/types.js";

export interface ContextHistoryRepository {
  /**
   * Returns messages newest first. The cursor is exclusive so pages can be
   * consumed without duplicates while a bounded context window is assembled.
   */
  listMessagePage(input: {
    threadId: string;
    limit: number;
    before?: MessagePageCursor;
  }): Promise<MessagePage>;
}

export interface ContextSourceInput {
  thread: Thread;
  currentMessage: Message;
  signal?: AbortSignal;
}

export interface ContextCandidate extends AssistantContextBlock {
  /** Higher-priority blocks are offered budget before lower-priority blocks. */
  priority: number;
}

/**
 * A source is a replaceable seam for owner settings, memories, projects,
 * retrieved files, tool results, or any other future context.
 */
export interface ContextSource {
  readonly id: string;
  load(input: ContextSourceInput): Promise<ReadonlyArray<ContextCandidate>>;
}

export interface TokenEstimator {
  readonly id: string;
  estimateMessage(message: Pick<Message, "role" | "content">): number;
  estimateBlock(block: AssistantContextBlock): number;
}

export interface ContextDiagnostics {
  version: 1;
  estimator: string;
  budgetTokens: number;
  estimatedTokens: number;
  remainingTokens: number;
  overBudget: boolean;
  history: {
    pageSize: number;
    pagesRead: number;
    messagesConsidered: number;
    messagesSelected: number;
    turnsSelected: number;
    failedMessagesExcluded: number;
    incoherentMessagesExcluded: number;
    truncated: boolean;
  };
  sources: {
    candidates: number;
    blocksSelected: number;
    blocksOmitted: number;
    selectedSourceIds: string[];
  };
}

export interface AssembledContext {
  messages: ReadonlyArray<Pick<Message, "role" | "content">>;
  blocks: ReadonlyArray<AssistantContextBlock>;
  diagnostics: ContextDiagnostics;
}

export interface ConversationContextAssembler {
  assemble(input: ContextSourceInput): Promise<AssembledContext>;
}

export interface PersonalisationSummary {
  ownerDisplayName: string | null;
  assistantDisplayName: string | null;
}

export interface PersonalisationReader {
  getSummary(): Promise<PersonalisationSummary>;
}
