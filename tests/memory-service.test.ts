import { describe, expect, it } from "vitest";
import type {
  ConversationRepository,
  Message,
  Thread,
  ThreadSummary,
} from "../src/core/chat/types.js";
import { MemoryService } from "../src/core/memory/memory-service.js";
import type {
  ExtractedMemoryDraft,
  MemoryDraft,
  MemoryExtractionGateway,
  MemoryExtractionInput,
  MemoryItem,
  MemoryRepository,
  MemoryStatus,
} from "../src/core/memory/types.js";
import { DatabaseMemorySource } from "../src/infrastructure/context/database-memory-source.js";
import { MockMemoryExtractor } from "../src/infrastructure/memory/mock-memory-extractor.js";

const now = "2026-08-16T12:00:00.000Z";
const thread: Thread = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Memory evidence",
  kind: "temporary",
  createdAt: now,
  updatedAt: now,
};

function message(
  id: number,
  role: Message["role"],
  content: string,
  status: Message["status"] = "complete",
): Message {
  return {
    id: `20000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    threadId: thread.id,
    role,
    content,
    status,
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    metadata: {},
    createdAt: now,
  };
}

class FixedConversations implements ConversationRepository {
  public constructor(public readonly messages: Message[]) {}

  public async createThread(): Promise<Thread> {
    return thread;
  }

  public async findThread(threadId: string): Promise<Thread | null> {
    return threadId === thread.id ? thread : null;
  }

  public async listThreads(): Promise<ThreadSummary[]> {
    return [];
  }

  public async updateThreadTitle(): Promise<Thread | null> {
    return thread;
  }

  public async archiveThread(): Promise<boolean> {
    return true;
  }

  public async listMessages(threadId: string, limit = 100): Promise<Message[]> {
    return this.messages.filter((candidate) => candidate.threadId === threadId).slice(-limit);
  }

  public async findMessage(messageId: string): Promise<Message | null> {
    return this.messages.find((candidate) => candidate.id === messageId) ?? null;
  }

  public async hasMessagesAfter(): Promise<boolean> {
    return false;
  }

  public async addMessage(): Promise<Message> {
    throw new Error("Not used by the memory service tests.");
  }
}

class InMemoryMemoryRepository implements MemoryRepository {
  public readonly items: MemoryItem[] = [];
  private nextId = 1;

  public async listMemories(
    statuses: ReadonlyArray<MemoryStatus>,
    limit = 100,
  ): Promise<MemoryItem[]> {
    return this.items.filter((item) => statuses.includes(item.status)).slice(-limit).reverse();
  }

  public async countMemories(): Promise<Record<MemoryStatus, number>> {
    return {
      proposed: this.items.filter((item) => item.status === "proposed").length,
      active: this.items.filter((item) => item.status === "active").length,
      superseded: this.items.filter((item) => item.status === "superseded").length,
      rejected: this.items.filter((item) => item.status === "rejected").length,
    };
  }

  public async findMemory(id: string): Promise<MemoryItem | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  public async addProposals(input: {
    threadId: string;
    proposals: ReadonlyArray<ExtractedMemoryDraft>;
    provider: string;
    model: string;
  }): Promise<{ created: number; skipped: number }> {
    let created = 0;
    for (const proposal of input.proposals) {
      const duplicate = this.items.some(
        (item) =>
          item.source.id === proposal.sourceMessageId &&
          item.kind === proposal.kind &&
          item.subject.toLowerCase() === proposal.subject.toLowerCase() &&
          item.content === proposal.content,
      );
      if (duplicate) continue;
      this.items.push(
        this.createItem({
          ...proposal,
          status: "proposed",
          sourceType: "message",
          sourceId: proposal.sourceMessageId,
          provider: input.provider,
          model: input.model,
        }),
      );
      created += 1;
    }
    return { created, skipped: input.proposals.length - created };
  }

  public async createOwnerMemory(input: MemoryDraft): Promise<MemoryItem> {
    this.supersedeMatching(input);
    const item = this.createItem({
      ...input,
      status: "active",
      confidence: 1,
      rationale: "Added directly by the owner.",
      sourceType: "owner",
      sourceId: null,
      provider: null,
      model: null,
    });
    this.items.push(item);
    return item;
  }

  public async updateProposedMemory(
    id: string,
    input: MemoryDraft,
  ): Promise<MemoryItem | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "proposed") return null;
    Object.assign(item, input, {
      confidence: 1,
      source: { ...item.source, type: "owner_edited_message" },
      updatedAt: now,
    });
    return item;
  }

  public async supersedeActiveMemory(
    id: string,
    input: MemoryDraft,
  ): Promise<MemoryItem | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "active") return null;
    item.status = "superseded";
    item.validUntil = now;
    this.supersedeMatching(input);
    const replacement = this.createItem({
      ...input,
      status: "active",
      confidence: 1,
      rationale: "Revised by the owner.",
      sourceType: "memory_revision",
      sourceId: id,
      supersedesId: id,
      provider: null,
      model: null,
    });
    this.items.push(replacement);
    return replacement;
  }

  public async approveMemory(id: string): Promise<MemoryItem | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "proposed") return null;
    this.supersedeMatching(item);
    item.status = "active";
    item.validFrom = now;
    item.lastConfirmedAt = now;
    return item;
  }

  public async rejectMemory(id: string): Promise<MemoryItem | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "proposed") return null;
    item.status = "rejected";
    return item;
  }

  public async forgetMemory(id: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  public async searchActiveMemories(input: {
    query: string;
    limit: number;
    maxSensitivity: number;
  }): Promise<MemoryItem[]> {
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.items
      .filter(
        (item) =>
          item.status === "active" &&
          item.sensitivity <= input.maxSensitivity &&
          terms.some((term) => (item.subject + " " + item.content).toLowerCase().includes(term)),
      )
      .slice(0, input.limit);
  }

  private supersedeMatching(input: Pick<MemoryDraft, "kind" | "subject">) {
    for (const item of this.items) {
      if (
        item.status === "active" &&
        item.kind === input.kind &&
        item.subject.toLowerCase() === input.subject.toLowerCase()
      ) {
        item.status = "superseded";
        item.validUntil = now;
      }
    }
  }

  private createItem(
    input: MemoryDraft & {
      status: MemoryStatus;
      confidence: number;
      rationale: string;
      sourceType: string;
      sourceId: string | null;
      supersedesId?: string | null;
      provider: string | null;
      model: string | null;
    },
  ): MemoryItem {
    const id = `30000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return {
      id,
      kind: input.kind,
      subject: input.subject,
      content: input.content,
      status: input.status,
      confidence: input.confidence,
      importance: input.importance,
      sensitivity: input.sensitivity,
      rationale: input.rationale,
      source: {
        type: input.sourceType,
        id: input.sourceId,
        excerpt: input.sourceType === "message" ? input.content : null,
        threadId: input.sourceType === "message" ? thread.id : null,
        threadTitle: input.sourceType === "message" ? thread.title : null,
      },
      supersedesId: input.supersedesId ?? null,
      validFrom: input.status === "active" ? now : null,
      validUntil: null,
      lastConfirmedAt: input.status === "active" ? now : null,
      extraction: { provider: input.provider, model: input.model },
      createdAt: now,
      updatedAt: now,
    };
  }
}

class SourceCheckingExtractor implements MemoryExtractionGateway {
  public readonly provider = "test";
  public readonly model = "source-checking";
  public seen: MemoryExtractionInput | null = null;

  public async extract(input: MemoryExtractionInput) {
    this.seen = input;
    const source = input.messages[0];
    if (!source) throw new Error("Expected an owner message.");
    const proposal: ExtractedMemoryDraft = {
      sourceMessageId: source.id,
      kind: "preference",
      subject: "Editor theme",
      content: "The owner prefers a dark editor theme.",
      confidence: 0.98,
      importance: 60,
      sensitivity: 0,
      rationale: "The owner stated this preference directly.",
    };
    return {
      provider: this.provider,
      model: this.model,
      proposals: [
        proposal,
        { ...proposal, sourceMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      ],
    };
  }
}

describe("honest memory", () => {
  it("keeps model proposals out of context until the owner approves them", async () => {
    const ownerMessage = message(1, "user", "I prefer a dark editor theme.");
    const extractor = new SourceCheckingExtractor();
    const memories = new InMemoryMemoryRepository();
    const service = new MemoryService(
      memories,
      new FixedConversations([
        ownerMessage,
        message(2, "assistant", "Understood."),
        message(3, "user", "An incomplete claim", "cancelled"),
      ]),
      extractor,
      1,
    );
    const source = new DatabaseMemorySource(memories, 1);

    await expect(service.extractFromThread(thread.id)).resolves.toMatchObject({
      candidates: 1,
      created: 1,
    });
    expect(extractor.seen?.messages.map((candidate) => candidate.id)).toEqual([ownerMessage.id]);

    await expect(
      source.load({ thread, currentMessage: message(4, "user", "Which editor theme?") }),
    ).resolves.toEqual([]);

    const proposed = memories.items[0];
    if (!proposed) throw new Error("Expected a proposed memory.");
    await expect(service.approve(proposed.id)).resolves.toMatchObject({ status: "active" });

    const blocks = await source.load({
      thread,
      currentMessage: message(5, "user", "Which editor theme do I prefer?"),
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      source: "approved-memory",
      trust: "application",
      title: "Approved preference: Editor theme",
    });
    expect(blocks[0]?.content).toContain("dark editor theme");
  });

  it("preserves review history when a memory is edited, rejected, or superseded", async () => {
    const memories = new InMemoryMemoryRepository();
    const proposal = await memories.addProposals({
      threadId: thread.id,
      provider: "test",
      model: "fixed",
      proposals: [
        {
          sourceMessageId: message(1, "user", "Remember that tea is my default drink.").id,
          kind: "preference",
          subject: "Default drink",
          content: "Tea is the owner's default drink.",
          confidence: 0.95,
          importance: 45,
          sensitivity: 0,
          rationale: "The owner explicitly asked for this to be remembered.",
        },
      ],
    });
    expect(proposal.created).toBe(1);
    const service = new MemoryService(
      memories,
      new FixedConversations([]),
      new MockMemoryExtractor(),
      3,
    );
    const first = memories.items[0];
    if (!first) throw new Error("Expected a proposed memory.");

    const edited = await service.edit(first.id, {
      kind: "preference",
      subject: "Default drink",
      content: "Earl Grey tea is the owner's default drink.",
      importance: 55,
      sensitivity: 0,
    });
    expect(edited).toMatchObject({
      status: "proposed",
      importance: 55,
      confidence: 1,
      source: { type: "owner_edited_message" },
    });
    const active = await service.approve(first.id);
    const replacement = await service.edit(active.id, {
      kind: "preference",
      subject: "Default drink",
      content: "Coffee is the owner's default drink.",
      importance: 60,
      sensitivity: 0,
    });

    expect(await memories.findMemory(first.id)).toMatchObject({ status: "superseded" });
    expect(replacement).toMatchObject({ status: "active", supersedesId: first.id });
    await expect(service.reject(replacement.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await service.forget(replacement.id);
    await expect(memories.findMemory(replacement.id)).resolves.toBeNull();
  });

  it("only treats an explicit leading remember request as a mock proposal", async () => {
    const extractor = new MockMemoryExtractor();
    const result = await extractor.extract({
      thread,
      messages: [
        message(1, "user", "Please remember that I use metric units."),
        message(2, "user", "A character said, ‘remember that I fear heights’."),
        message(3, "user", "Do you remember that fictional example?"),
        message(4, "user", "Don't remember this temporary password."),
        message(5, "user", "Please remember that my API key is sk-not-a-real-test-key."),
      ],
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      sourceMessageId: message(1, "user", "").id,
      content: "I use metric units.",
    });
  });
});
