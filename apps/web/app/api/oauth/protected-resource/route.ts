import { protectedResourceMetadata } from "@/lib/server/mcp/auth";

export async function GET(req: Request): Promise<Response> {
  return Response.json(protectedResourceMetadata(req), { headers: { "Access-Control-Allow-Origin": "*" } });
}
