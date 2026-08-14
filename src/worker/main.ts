import { config } from "../shared/config.js";
import { createPool } from "../infrastructure/db/pool.js";
import { createJobQueue } from "../infrastructure/jobs/job-queue.js";
import { registerHousekeeping } from "./jobs/housekeeping.js";

const pool = createPool(config.databaseUrl);
const boss = await createJobQueue(config.databaseUrl);
await registerHousekeeping(boss, pool);

console.log("Background worker is ready.");

async function shutDown(signal: string) {
  console.log(`Stopping background worker (${signal}).`);
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", () => void shutDown("SIGINT"));
process.once("SIGTERM", () => void shutDown("SIGTERM"));
