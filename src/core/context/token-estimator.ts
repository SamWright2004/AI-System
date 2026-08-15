import type { AssistantContextBlock, Message } from "../chat/types.js";
import type { TokenEstimator } from "./types.js";

const encoder = new TextEncoder();

function estimateText(text: string): number {
  if (!text) return 0;

  // This deliberately favours a little headroom. Provider tokenisers can be
  // introduced behind TokenEstimator without changing context-selection rules.
  return Math.max(1, Math.ceil(encoder.encode(text).byteLength / 3.5));
}

export class Utf8HeuristicTokenEstimator implements TokenEstimator {
  public readonly id = "utf8-heuristic-v1";

  public estimateMessage(message: Pick<Message, "role" | "content">): number {
    return 4 + estimateText(message.role) + estimateText(message.content);
  }

  public estimateBlock(block: AssistantContextBlock): number {
    return (
      12 +
      estimateText(block.id) +
      estimateText(block.source) +
      estimateText(block.title) +
      estimateText(block.trust) +
      estimateText(block.content)
    );
  }
}
