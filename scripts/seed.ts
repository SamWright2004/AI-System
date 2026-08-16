import { config } from "../src/shared/config.js";
import { createPool } from "../src/infrastructure/db/pool.js";

const pool = createPool(config.databaseUrl);

const activity = [
  {
    key: "foundation-ready",
    kind: "completed",
    title: "Foundation ready",
    body: "I’ve created the local workspace and its permanent data model. Nothing external has been connected yet.",
    review: false,
  },
  {
    key: "model-review",
    kind: "review",
    title: "Your review is needed",
    body: "I’m using mock replies until you choose and connect a model provider. Everything else can be tested safely first.",
    review: true,
  },
  {
    key: "memory-deliberate",
    kind: "completed",
    title: "Honest memory is ready",
    body: "Conversation review now creates sourced proposals. Nothing enters future replies until you approve it in Memory.",
    review: false,
  },
] as const;

async function seed() {
  for (const item of activity) {
    await pool.query(
      `INSERT INTO activity_items (dedupe_key, kind, title, body, requires_review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [item.key, item.kind, item.title, item.body, item.review],
    );
  }
}

seed()
  .then(() => console.log("Seed data is ready."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
