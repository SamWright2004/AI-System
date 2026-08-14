import type { PgBoss } from "pg-boss";
import { jobNames } from "../../infrastructure/jobs/job-queue.js";
import type { DatabasePool } from "../../infrastructure/db/pool.js";

export async function registerHousekeeping(boss: PgBoss, pool: DatabasePool) {
  return boss.work(jobNames.housekeeping, async ([job]) => {
    if (!job) return;
    await pool.query(
      `INSERT INTO audit_events (actor, action, entity_type, detail)
       VALUES ('worker', 'housekeeping.completed', 'job', $1::jsonb)`,
      [JSON.stringify({ jobId: job.id })],
    );
  });
}
