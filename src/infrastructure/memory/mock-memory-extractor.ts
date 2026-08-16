import type {
  ExtractedMemoryDraft,
  MemoryExtractionGateway,
  MemoryExtractionInput,
} from "../../core/memory/types.js";

function classify(content: string): ExtractedMemoryDraft["kind"] {
  if (/\bprefer|\blike|\bdislike|\bfavou?r/i.test(content)) return "preference";
  if (/\bevery|\busually|\broutine|\beach (day|week|month)/i.test(content)) return "routine";
  if (/\bdecid(?:e|ed)|\bdecision/i.test(content)) return "decision";
  if (/\bproject|\bfilm|\bbuild|\brepository/i.test(content)) return "project";
  return "fact";
}

function subjectFrom(content: string): string {
  const words = content
    .replace(/[.!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 9);
  const subject = words.join(" ");
  return subject.length > 120 ? subject.slice(0, 119) + "…" : subject;
}

export class MockMemoryExtractor implements MemoryExtractionGateway {
  public readonly provider = "mock";
  public readonly model = "explicit-memory-v1";

  public async extract(input: MemoryExtractionInput) {
    const proposals: ExtractedMemoryDraft[] = [];

    for (const message of input.messages) {
      input.signal?.throwIfAborted();
      const match =
        /^\s*(?:(?:(?:can|could|would)\s+you\s+)?please\s+|(?:can|could|would)\s+you\s+)?remember(?: that| this)?(?:\s*:)?\s+(.+)/is.exec(
          message.content,
        );
      const content = match?.[1]?.trim();
      if (!content) continue;

      const boundedContent = content.slice(0, 1_000);
      proposals.push({
        sourceMessageId: message.id,
        kind: classify(boundedContent),
        subject: subjectFrom(boundedContent),
        content: boundedContent,
        confidence: 1,
        importance: 60,
        sensitivity: 0,
        rationale: "The owner explicitly asked the system to remember this statement.",
      });
    }

    return {
      provider: this.provider,
      model: this.model,
      proposals: proposals.slice(0, 30),
    };
  }
}
