import { openDb } from "@focal-ai/db";
const db = openDb(process.env.DATABASE_URL!);
const rows = await db.sql`select id, actor, action, undoes, undone_by, at from activity_events where user_id = (select id from users where email='live-e2e@focal.test') and actor='page' order by at desc limit 4`;
console.log(JSON.stringify(rows, null, 1));
await db.sql.end();
