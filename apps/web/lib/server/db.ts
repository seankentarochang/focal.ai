import { openDb, type Db } from "@focal-ai/db";

let db: Db | null | undefined;

/** Shared Postgres access; null when DATABASE_URL is not configured. */
export function getDb(): Db | null {
  if (db === undefined) {
    const url = process.env.DATABASE_URL?.trim();
    db = url ? openDb(url, { max: 5 }) : null;
  }
  return db;
}

export function __setDbForTests(next: Db | null | undefined): void {
  db = next;
}
