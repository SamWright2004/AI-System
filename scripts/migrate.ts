import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../src/shared/config.js";
import { createPool } from "../src/infrastructure/db/pool.js";

const migrationsDirectory = resolve(process.cwd(), "db/migrations");
const pool = createPool(config.databaseUrl);

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query("SELECT pg_advisory_lock($1)", [1_934_581]);
    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of filenames) {
      const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [filename],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `Migration ${filename} changed after it was applied. Create a new migration instead.`,
          );
        }
        console.log(`already applied  ${filename}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
          filename,
          checksum,
        ]);
        await client.query("COMMIT");
        console.log(`applied          ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [1_934_581]).catch(() => undefined);
    client.release();
  }
}

migrate()
  .then(() => console.log("Database is up to date."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
