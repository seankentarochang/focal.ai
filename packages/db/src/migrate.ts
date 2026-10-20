import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const LOCK_ID = 7_340_201;

export interface Migration {
  name: string;
  sql: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(/*turbopackIgnore: true*/ join(dir, name), "utf8") }));
}

/** Applies pending migrations in order, each in its own transaction. Returns the names applied. */
export async function migrate(sql: Sql, migrations = loadMigrations()): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied: string[] = [];
  for (const m of migrations) {
    const did = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
      const [done] = await tx`SELECT 1 FROM schema_migrations WHERE name = ${m.name}`;
      if (done) return false;
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (name) VALUES (${m.name})`;
      return true;
    });
    if (did) applied.push(m.name);
  }
  return applied;
}
