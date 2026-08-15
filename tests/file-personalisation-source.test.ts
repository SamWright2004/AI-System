import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Message, Thread } from "../src/core/chat/types.js";
import type { PersonalisationProfile } from "../src/core/settings/types.js";
import { FilePersonalisationSource } from "../src/infrastructure/context/file-personalisation-source.js";

const thread: Thread = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Home",
  kind: "primary",
  createdAt: "2026-08-15T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
};

const currentMessage: Message = {
  id: "22222222-2222-4222-8222-222222222222",
  threadId: thread.id,
  role: "user",
  content: "Hello",
  status: "complete",
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
  metadata: {},
  createdAt: "2026-08-15T10:01:00.000Z",
};

function profile(ownerName: string, assistantName: string) {
  return JSON.stringify({
    version: 1,
    owner: { displayName: ownerName, locale: "en-GB", timezone: "Europe/London" },
    assistant: {
      displayName: assistantName,
      tone: ["direct", "warm"],
      responseDetail: "adaptive",
    },
    workingStyle: {
      initiative: "high",
      challengeAssumptions: true,
      surfaceUncertainty: true,
    },
    pinnedInstructions: ["Prefer useful specifics."],
  });
}

describe("FilePersonalisationSource", () => {
  it("hot-reloads owner-controlled settings and produces trusted context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-ai-profile-"));
    const filePath = join(directory, "profile.json");

    try {
      await writeFile(filePath, profile("Sam", "Atlas"), "utf8");
      const source = new FilePersonalisationSource(filePath);

      const blocks = await source.load({ thread, currentMessage });
      expect(blocks[0]).toMatchObject({
        source: "personalisation-file",
        trust: "owner",
        priority: 1_000,
      });
      expect(blocks[0]?.content).toContain("Owner display name: Sam");
      expect(await source.getProfile()).toMatchObject({
        owner: { displayName: "Sam" },
        assistant: { displayName: "Atlas" },
      });

      await writeFile(filePath, profile("Sam", "Nova"), "utf8");
      expect(await source.getProfile()).toMatchObject({
        owner: { displayName: "Sam" },
        assistant: { displayName: "Nova" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("is optional when the local profile does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "missing-personal-ai-profile-"));
    const source = new FilePersonalisationSource(join(directory, "profile.json"));

    try {
      await expect(source.load({ thread, currentMessage })).resolves.toEqual([]);
      await expect(source.getProfile()).resolves.toMatchObject({
        owner: { displayName: "" },
        assistant: { displayName: "" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports malformed settings instead of silently ignoring them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invalid-personal-ai-profile-"));
    const filePath = join(directory, "profile.json");

    try {
      await writeFile(filePath, '{"version": 2}', "utf8");
      const source = new FilePersonalisationSource(filePath);

      await expect(source.load({ thread, currentMessage })).rejects.toThrow(
        "Invalid personalisation profile",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates and persists settings written by the application", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writable-personal-ai-profile-"));
    const filePath = join(directory, "nested", "profile.json");
    const source = new FilePersonalisationSource(filePath);

    try {
      const saved = await source.updateProfile(
        JSON.parse(profile("Sam", "Nova")) as PersonalisationProfile,
      );
      expect(saved.assistant.displayName).toBe("Nova");
      await expect(source.getProfile()).resolves.toEqual(saved);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
