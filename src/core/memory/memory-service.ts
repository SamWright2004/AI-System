import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { ConversationRepository, Message } from "../chat/types.js";
import type {
  MemoryDraft,
  MemoryExtractionGateway,
  MemoryExtractionSummary,
  MemoryIndexManager,
  MemoryIndexSummary,
  MemoryItem,
  MemoryOverview,
  MemoryRepository,
  MemoryRetrievalResult,
  MemoryRetriever,
} from "./types.js";

const extractionCharacterBudget = 32_000;
const extractionMessageLimit = 40;

function selectExtractionMessages(messages: Message[]) {
  const selected: Array<Pick<Message, "id" | "content" | "createdAt">> = [];
  let characters = 0;

  for (const message of [...messages].reverse()) {
    if (message.role !== "user" || message.status !== "complete") continue;
    if (selected.length >= extractionMessageLimit) break;

    const content = message.content.slice(0, 8_000);
    if (characters + content.length > extractionCharacterBudget && selected.length > 0) break;
    selected.push({ id: message.id, content, createdAt: message.createdAt });
    characters += content.length;
  }

  return selected.reverse();
}

export class MemoryService {
  public constructor(
    private readonly memories: MemoryRepository,
    private readonly conversations: ConversationRepository,
    private readonly extractor: MemoryExtractionGateway,
    private readonly contextMaxSensitivity: number,
    private readonly retriever?: MemoryRetriever,
    private readonly indexManager?: MemoryIndexManager,
  ) {}

  public async getOverview(): Promise<MemoryOverview> {
    const [counts, proposed, active, history, index] = await Promise.all([
      this.memories.countMemories(),
      this.memories.listMemories(["proposed"], 100),
      this.memories.listMemories(["active"], 200),
      this.memories.listMemories(["superseded", "rejected"], 100),
      this.indexManager?.getStatus() ??
        Promise.resolve({
          enabled: false,
          provider: null,
          model: null,
          dimensions: null,
          eligible: 0,
          indexed: 0,
          pending: 0,
        }),
    ]);

    return {
      counts,
      proposed,
      active,
      history,
      extractor: {
        provider: this.extractor.provider,
        model: this.extractor.model,
      },
      contextPolicy: {
        maxSensitivity: this.contextMaxSensitivity,
      },
      index,
    };
  }

  public async extractFromThread(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<MemoryExtractionSummary> {
    const thread = await this.conversations.findThread(threadId);
    if (!thread) throw new NotFoundError("That conversation no longer exists.");

    const messages = selectExtractionMessages(
      await this.conversations.listMessages(thread.id, 500),
    );
    if (messages.length === 0) {
      return {
        created: 0,
        skipped: 0,
        candidates: 0,
        provider: this.extractor.provider,
        model: this.extractor.model,
      };
    }

    let extraction;
    try {
      extraction = await this.extractor.extract({
        thread: { id: thread.id, title: thread.title },
        messages,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The extraction model failed.";
      throw new AppError(detail, "MEMORY_EXTRACTION_FAILED", 502, { cause: error });
    }

    const allowedMessageIds = new Set(messages.map((message) => message.id));
    const proposals = extraction.proposals
      .filter((proposal) => allowedMessageIds.has(proposal.sourceMessageId))
      .slice(0, 30);
    const saved = await this.memories.addProposals({
      threadId: thread.id,
      proposals,
      provider: extraction.provider,
      model: extraction.model,
    });

    return {
      ...saved,
      candidates: proposals.length,
      provider: extraction.provider,
      model: extraction.model,
    };
  }

  public async createOwnerMemory(input: MemoryDraft): Promise<MemoryItem> {
    const memory = await this.memories.createOwnerMemory(input);
    await this.tryIndex(memory);
    return memory;
  }

  public async approve(id: string): Promise<MemoryItem> {
    const memory = await this.requireMemory(id);
    if (memory.status !== "proposed") {
      throw new ConflictError("Only a proposed memory can be approved.");
    }

    const approved = await this.memories.approveMemory(id);
    if (!approved) throw new ConflictError("The memory changed before it could be approved.");
    await this.tryIndex(approved);
    return approved;
  }

  public async edit(id: string, input: MemoryDraft): Promise<MemoryItem> {
    const memory = await this.requireMemory(id);
    if (memory.status === "proposed") {
      const updated = await this.memories.updateProposedMemory(id, input);
      if (!updated) throw new ConflictError("The memory changed before it could be edited.");
      return updated;
    }
    if (memory.status === "active") {
      const replacement = await this.memories.supersedeActiveMemory(id, input);
      if (!replacement) {
        throw new ConflictError("The memory changed before it could be superseded.");
      }
      await this.tryIndex(replacement);
      return replacement;
    }
    throw new ConflictError("Rejected or superseded memories cannot be edited.");
  }

  public async reject(id: string): Promise<MemoryItem> {
    const memory = await this.requireMemory(id);
    if (memory.status !== "proposed") {
      throw new ConflictError("Only a proposed memory can be rejected.");
    }
    const rejected = await this.memories.rejectMemory(id);
    if (!rejected) throw new ConflictError("The memory changed before it could be rejected.");
    return rejected;
  }

  public async forget(id: string): Promise<void> {
    await this.requireMemory(id);
    if (!(await this.memories.forgetMemory(id))) {
      throw new NotFoundError("That memory no longer exists.");
    }
  }

  public async search(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<MemoryRetrievalResult> {
    if (this.retriever) {
      return this.retriever.retrieve({
        query,
        limit,
        maxSensitivity: this.contextMaxSensitivity,
        ...(signal ? { signal } : {}),
      });
    }

    const memories = await this.memories.searchActiveMemories({
      query,
      limit,
      maxSensitivity: this.contextMaxSensitivity,
    });
    return {
      query,
      mode: "lexical",
      matches: memories.map((memory) => ({
        memory,
        score: {
          lexical: 1,
          semantic: null,
          importance: memory.importance / 100,
          recency: 0,
          combined: 1,
        },
        reasons: ["wording match"],
      })),
      diagnostics: {
        lexicalCandidates: memories.length,
        semanticCandidates: 0,
        indexedBeforeSearch: 0,
        embeddingProvider: null,
        embeddingModel: null,
        fallbackReason: null,
      },
    };
  }

  public async indexMemories(signal?: AbortSignal): Promise<MemoryIndexSummary> {
    if (!this.indexManager) {
      throw new ConflictError(
        "Semantic memory is disabled. Configure a local or OpenAI embedding provider first.",
      );
    }
    return this.indexManager.indexPending({ limit: 5_000, ...(signal ? { signal } : {}) });
  }

  private async requireMemory(id: string): Promise<MemoryItem> {
    const memory = await this.memories.findMemory(id);
    if (!memory) throw new NotFoundError("That memory no longer exists.");
    return memory;
  }

  private async tryIndex(memory: MemoryItem): Promise<void> {
    if (!this.indexManager) return;
    await this.indexManager.indexMemory(memory).catch(() => undefined);
  }
}
