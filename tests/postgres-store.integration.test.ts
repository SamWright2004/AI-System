import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, type DatabasePool } from "../src/infrastructure/db/pool.js";
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
    if (createdThreadIds.length === 0) return;
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
});
