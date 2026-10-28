import { openDb } from "@focal-ai/db";
const db = openDb(process.env.DATABASE_URL!);
const rows = await db.sql`select id, items, meta, status, created_at from page_results where user_id = (select id from users where email='live-e2e@focal.test') order by created_at desc limit 3`;
for (const row of rows as { id: string; status: string; items: { name: string; status: string; outcome?: string; score?: number; affinityPct?: number }[]; meta: unknown }[]) {
  console.log("==", row.id.slice(0, 8), row.status, "meta:", JSON.stringify(row.meta).slice(0, 300));
  for (const i of row.items) console.log("  ", i.name, "|", i.status, "|", i.outcome, "|score:", i.score ?? i.affinityPct ?? "-");
}
await db.sql.end();
