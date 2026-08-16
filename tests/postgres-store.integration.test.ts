import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, type DatabasePool } from "../src/infrastructure/db/pool.js";
import { PostgresMemoryRepository } from "../src/infrastructure/db/postgres-memory-repository.js";
import { PostgresStore } from "../src/infrastructure/db/postgres-store.js";
import { createApp } from "../src/server/app.js";
import { config } from "../src/shared/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresStore integration", () => {
  let pool: DatabasePool;
  let store: PostgresStore;
  let app: Awaited<ReturnType<typeof createApp>>;
  let profileDirectory: string;
  const createdThreadIds: string[] = [];
  const createdMemoryIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
    pool = createPool(databaseUrl);
    store = new PostgresStore(pool);
    profileDirectory = await mkdtemp(join(tmpdir(), "personal-ai-api-integration-"));
    app = await createApp({
      ...config,
      appEnv: "test",
      databaseUrl,
      aiProvider: "mock",
      logLevel: "silent",
      personalisationFile: join(profileDirectory, "profile.json"),
      serveUi: false,
    });
  });

  afterEach(async () => {
    if (createdMemoryIds.length > 0) {
      await pool.query("DELETE FROM memory_items WHERE id = ANY($1::uuid[])", [
        createdMemoryIds,
      ]);
      createdMemoryIds.length = 0;
    }
    if (createdThreadIds.length === 0) return;
    await pool.query(
      `DELETE FROM memory_items AS revision
       USING memory_items AS source, messages AS source_message
       WHERE revision.source_type = 'memory_revision'
         AND revision.source_id = source.id
         AND source.source_type IN ('message', 'owner_edited_message')
         AND source.source_id = source_message.id
         AND source_message.thread_id = ANY($1::uuid[])`,
      [createdThreadIds],
    );
    await pool.query(
      `DELETE FROM memory_items AS memory
       USING messages AS source_message
       WHERE memory.source_type IN ('message', 'owner_edited_message')
         AND memory.source_id = source_message.id
         AND source_message.thread_id = ANY($1::uuid[])`,
      [createdThreadIds],
    );
    await pool.query("DELETE FROM activity_items WHERE metadata ->> 'threadId' = ANY($1::text[])", [
      createdThreadIds,
    ]);
    await pool.query("DELETE FROM threads WHERE id = ANY($1::uuid[])", [createdThreadIds]);
    createdThreadIds.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (profileDirectory) {
      await rm(profileDirectory, { recursive: true, force: true });
    }
  });

  it("persists, lists, renames and archives a complete conversation lifecycle", async () => {
    const thread = await store.createThread({
      title: "Integration conversation",
      kind: "temporary",
    });
    createdThreadIds.push(thread.id);

    const user = await store.addMessage({
      threadId: thread.id,
      role: "user",
      content: "Please begin.",
    });
    await store.addMessage({
      threadId: thread.id,
      role: "assistant",
      content: "A partial reply",
      status: "cancelled",
      provider: "test",
      model: "integration",
      metadata: { error: { code: "CANCELLED" } },
    });

    await expect(store.hasMessagesAfter(user)).resolves.toBe(true);
    await expect(store.findMessage(user.id)).resolves.toMatchObject({
      role: "user",
      content: "Please begin.",
    });
    await expect(store.listMessages(thread.id)).resolves.toMatchObject([
      { role: "user", status: "complete" },
      { role: "assistant", status: "cancelled" },
    ]);

    const summaries = await store.listThreads();
    expect(summaries.find((candidate) => candidate.id === thread.id)).toMatchObject({
      title: "Integration conversation",
      messageCount: 2,
      lastMessagePreview: "A partial reply",
    });

    await expect(store.updateThreadTitle(thread.id, "Renamed conversation")).resolves.toMatchObject(
      {
        title: "Renamed conversation",
      },
    );
    await expect(store.archiveThread(thread.id)).resolves.toBe(true);
    await expect(store.findThread(thread.id)).resolves.toBeNull();
  });

  it("serves fresh bootstrap, thread controls and in-app settings over the local API", async () => {
    const thread = await store.createThread({
      title: "API conversation",
      kind: "temporary",
    });
    createdThreadIds.push(thread.id);
    await store.addMessage({
      threadId: thread.id,
      role: "user",
      content: "Stored but not selected on startup.",
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      threads: [{ id: thread.id, title: "API conversation" }],
      personalisation: { version: 1 },
    });
    expect(bootstrap.json()).not.toHaveProperty("thread");
    expect(bootstrap.json()).not.toHaveProperty("messages");

    const opened = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${thread.id}`,
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({
      thread: { id: thread.id },
      messages: [{ content: "Stored but not selected on startup." }],
    });

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/threads/${thread.id}`,
      payload: { title: "Renamed through API" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ title: "Renamed through API" });

    const settings = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/personalisation",
      payload: {
        version: 1,
        owner: { displayName: "Sam", locale: "en-GB", timezone: "Europe/London" },
        assistant: {
          displayName: "Nova",
          tone: ["natural", "direct"],
          responseDetail: "adaptive",
        },
        workingStyle: {
          initiative: "high",
          challengeAssumptions: true,
          surfaceUncertainty: true,
        },
        pinnedInstructions: ["Prefer useful specifics."],
      },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      owner: { displayName: "Sam" },
      assistant: { displayName: "Nova" },
    });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/threads/${thread.id}`,
    });
    expect(archived.statusCode).toBe(204);
    await expect(store.findThread(thread.id)).resolves.toBeNull();
  });

  it("keeps extracted memories proposed until approval and preserves revisions", async () => {
    const memoryRepository = new PostgresMemoryRepository(pool);
    const thread = await store.createThread({
      title: "Memory review integration",
      kind: "temporary",
    });
    createdThreadIds.push(thread.id);
    await store.addMessage({
      threadId: thread.id,
      role: "user",
      content: "Please remember that I prefer metric units.",
    });

    const extracted = await app.inject({
      method: "POST",
      url: "/api/v1/memories/extract",
      payload: { threadId: thread.id },
    });
    expect(extracted.statusCode).toBe(200);
    expect(extracted.json()).toMatchObject({ candidates: 1, created: 1 });

    const pending = await app.inject({ method: "GET", url: "/api/v1/memories" });
    expect(pending.statusCode).toBe(200);
    const proposed = pending.json().proposed.find(
      (memory: { source: { threadId: string | null } }) => memory.source.threadId === thread.id,
    ) as { id: string; status: string; source: { excerpt: string } } | undefined;
    expect(proposed).toMatchObject({
      status: "proposed",
      source: { excerpt: "Please remember that I prefer metric units." },
    });
    if (!proposed) throw new Error("Expected a proposed memory.");
    createdMemoryIds.push(proposed.id);

    await expect(
      memoryRepository.searchActiveMemories({
        query: "metric units",
        limit: 10,
        maxSensitivity: 3,
      }),
    ).resolves.toEqual([]);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/memories/${proposed.id}/approve`,
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "active", lastConfirmedAt: expect.any(String) });
    const settledHome = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });
    expect(
      settledHome
        .json()
        .activity.find(
          (item: { relatedType: string | null }) => item.relatedType === "memory_review",
        ),
    ).toBeUndefined();
    await expect(
      memoryRepository.searchActiveMemories({
        query: "metric units",
        limit: 10,
        maxSensitivity: 3,
      }),
    ).resolves.toMatchObject([{ id: proposed.id, status: "active" }]);

    const revised = await app.inject({
      method: "PATCH",
      url: `/api/v1/memories/${proposed.id}`,
      payload: {
        kind: "preference",
        subject: "Preferred units",
        content: "The owner prefers metric units unless a source requires otherwise.",
        importance: 65,
        sensitivity: 0,
      },
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({
      status: "active",
      supersedesId: proposed.id,
      source: { type: "memory_revision", id: proposed.id },
    });
    createdMemoryIds.push(revised.json().id as string);
    await expect(memoryRepository.findMemory(proposed.id)).resolves.toMatchObject({
      status: "superseded",
    });

    const forgotten = await app.inject({
      method: "DELETE",
      url: `/api/v1/memories/${revised.json().id as string}`,
    });
    expect(forgotten.statusCode).toBe(204);
    createdMemoryIds.pop();
  });
});
