import { QlooError, type QlooErrorCode } from "@focal-ai/qloo";
import { DbError } from "@focal-ai/db";
import { ZodError } from "zod";

const STATUS_BY_CODE: Record<QlooErrorCode, number> = {
  AUTH: 500,
  RATE_LIMIT: 429,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  TIMEOUT: 504,
  UPSTREAM: 502,
  PARSE: 502,
};

const AUTH_MESSAGE = "Qloo API key is not configured";

export function errorResponse(e: unknown): Response {
  if (e instanceof QlooError) {
    const status = STATUS_BY_CODE[e.code] ?? 502;
    const headers = new Headers();
    if (e.code === "RATE_LIMIT" && e.retryAfterMs !== undefined) {
      headers.set("Retry-After", String(Math.max(1, Math.ceil(e.retryAfterMs / 1000))));
    }
    return Response.json(
      { error: { code: e.code, message: e.code === "AUTH" ? AUTH_MESSAGE : e.message } },
      { status, headers },
    );
  }

  if (e instanceof DbError) {
    if (e.code === "CONFLICT") {
      return Response.json(
        { error: { code: "CONFLICT", message: "Your profile changed; try again" } },
        { status: 409 },
      );
    }
    if (e.code === "NOT_FOUND") {
      return Response.json({ error: { code: "NOT_FOUND", message: e.message } }, { status: 404 });
    }
  }

  if (e instanceof ZodError) {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "invalid request body", details: e.issues } },
      { status: 400 },
    );
  }

  return Response.json({ error: { code: "INTERNAL", message: "internal error" } }, { status: 500 });
}
