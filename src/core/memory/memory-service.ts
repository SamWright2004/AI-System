import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { ConversationRepository, Message } from "../chat/types.js";
import type {
  MemoryDraft,
  MemoryExtractionGateway,
  MemoryExtractionSummary,
  MemoryItem,
  MemoryOverview,
  MemoryRepository,
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
  ) {}

  public async getOverview(): Promise<MemoryOverview> {
    const [counts, proposed, active, history] = await Promise.all([
      this.memories.countMemories(),
      this.memories.listMemories(["proposed"], 100),
      this.memories.listMemories(["active"], 200),
      this.memories.listMemories(["superseded", "rejected"], 100),
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
    return this.memories.createOwnerMemory(input);
  }

  public async approve(id: string): Promise<MemoryItem> {
    const memory = await this.requireMemory(id);
    if (memory.status !== "proposed") {
      throw new ConflictError("Only a proposed memory can be approved.");
    }

    const approved = await this.memories.approveMemory(id);
    if (!approved) throw new ConflictError("The memory changed before it could be approved.");
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

  private async requireMemory(id: string): Promise<MemoryItem> {
    const memory = await this.memories.findMemory(id);
    if (!memory) throw new NotFoundError("That memory no longer exists.");
    return memory;
  }
}
