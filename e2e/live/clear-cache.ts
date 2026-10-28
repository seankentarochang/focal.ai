import { openDb } from "@focal-ai/db";
const db = openDb(process.env.DATABASE_URL!);
const r = await db.sql`delete from resolution_cache`;
console.log("resolution_cache cleared:", (r as unknown as { count: number }).count ?? "?");
await db.sql.end();
