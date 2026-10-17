import { connection } from "next/server";

export async function GET() {
  await connection();

  return Response.json({
    ok: true,
    hasQlooKey: Boolean(process.env.QLOO_API_KEY),
    dataSource: process.env.QLOO_MOCK === "1" ? "mock" : "live",
  });
}
