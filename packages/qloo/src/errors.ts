import type { QlooErrorCode } from "./types";

export interface QlooErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class QlooError extends Error {
  code: QlooErrorCode;
  status?: number;
  retryAfterMs?: number;

  constructor(code: QlooErrorCode, message: string, options: QlooErrorOptions = {}) {
    super(message);
    this.name = "QlooError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
