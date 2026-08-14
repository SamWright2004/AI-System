import { PgBoss } from "pg-boss";

export const jobNames = {
  housekeeping: "system.housekeeping",
} as const;

export async function createJobQueue(connectionString: string) {
  const boss = new PgBoss(connectionString);
  boss.on("error", (error) => console.error("Background queue error", error));
  await boss.start();
  await boss.createQueue(jobNames.housekeeping);
  return boss;
}
