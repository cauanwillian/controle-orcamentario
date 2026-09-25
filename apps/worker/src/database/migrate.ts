import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../migrations");
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    await client.query("CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");

    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migration WHERE version = $1", [file]);
      if (applied.rowCount) continue;

      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrationsDir, file), "utf8"));
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Migração aplicada: ${file}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
