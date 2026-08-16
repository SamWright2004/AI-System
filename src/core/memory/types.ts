import type { Message, Thread } from "../chat/types.js";

export const memoryKinds = [
  "fact",
  "preference",
  "relationship",
  "project",
  "routine",
  "decision",
  "working",
] as const;

export type MemoryKind = (typeof memoryKinds)[number];
export type MemoryStatus = "proposed" | "active" | "superseded" | "rejected";

export interface MemorySource {
  type: string;
  id: string | null;
  excerpt: string | null;
  threadId: string | null;
  threadTitle: string | null;
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  subject: string;
  content: string;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  sensitivity: number;
  rationale: string;
  source: MemorySource;
  supersedesId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastConfirmedAt: string | null;
  extraction: {
    provider: string | null;
    model: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDraft {
  kind: MemoryKind;
  subject: string;
  content: string;
  importance: number;
  sensitivity: number;
}

export interface ExtractedMemoryDraft extends MemoryDraft {
  sourceMessageId: string;
  confidence: number;
  rationale: string;
}

export interface MemoryExtractionInput {
  thread: Pick<Thread, "id" | "title">;
  messages: ReadonlyArray<Pick<Message, "id" | "content" | "createdAt">>;
  signal?: AbortSignal;
}

export interface MemoryExtractionResult {
  provider: string;
  model: string;
  proposals: ExtractedMemoryDraft[];
}

export interface MemoryExtractionGateway {
  readonly provider: string;
  readonly model: string;
  extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult>;
}

export interface MemoryOverview {
  counts: Record<MemoryStatus, number>;
  proposed: MemoryItem[];
  active: MemoryItem[];
  history: MemoryItem[];
  extractor: {
    provider: string;
    model: string;
  };
  contextPolicy: {
    maxSensitivity: number;
  };
}

export interface MemoryRepository {
  listMemories(statuses: ReadonlyArray<MemoryStatus>, limit?: number): Promise<MemoryItem[]>;
  countMemories(): Promise<Record<MemoryStatus, number>>;
  findMemory(id: string): Promise<MemoryItem | null>;
  addProposals(input: {
    threadId: string;
    proposals: ReadonlyArray<ExtractedMemoryDraft>;
    provider: string;
    model: string;
  }): Promise<{ created: number; skipped: number }>;
  createOwnerMemory(input: MemoryDraft): Promise<MemoryItem>;
  updateProposedMemory(id: string, input: MemoryDraft): Promise<MemoryItem | null>;
  supersedeActiveMemory(id: string, input: MemoryDraft): Promise<MemoryItem | null>;
  approveMemory(id: string): Promise<MemoryItem | null>;
  rejectMemory(id: string): Promise<MemoryItem | null>;
  forgetMemory(id: string): Promise<boolean>;
  searchActiveMemories(input: {
    query: string;
    limit: number;
    maxSensitivity: number;
  }): Promise<MemoryItem[]>;
}

export interface MemoryExtractionSummary {
  created: number;
  skipped: number;
  candidates: number;
  provider: string;
  model: string;
}
