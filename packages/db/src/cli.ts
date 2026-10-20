import { connect } from "./client";
import { migrate } from "./migrate";

// Migrations need a direct (session-mode) connection; Neon's pooled URL runs PgBouncer in transaction mode.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED or DATABASE_URL is not set");
  process.exit(1);
}
const sql = connect(url, { max: 1 });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await sql.end();
}
