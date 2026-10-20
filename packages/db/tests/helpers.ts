import { randomUUID } from "node:crypto";
import { connect, createDb, migrate, type Db } from "../src";

export const DATABASE_URL = process.env.DATABASE_URL;

/** A fresh, migrated schema per test file; dropped afterwards. */
export async function freshDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = connect(DATABASE_URL!, { max: 1 });
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const sql = connect(DATABASE_URL!, { schema, max: 4 });
  await migrate(sql);
  const db = createDb(sql);
  return {
    db,
    drop: async () => {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

let n = 0;
export const entry = (over: Record<string, unknown> = {}) => ({
  id: `e${++n}`,
  kind: "thing" as const,
  qlooId: `Q${n}`,
  name: `Thing ${n}`,
  type: "urn:entity:place",
  strength: "like" as const,
  source: "chat",
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});
