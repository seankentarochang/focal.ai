import postgres from "postgres";

export type Sql = postgres.Sql;
export type Json = postgres.JSONValue;

export interface ConnectOptions {
  /** Postgres schema to use (tests use a throwaway schema). */
  schema?: string;
  max?: number;
}

export function connect(url: string, opts: ConnectOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    connection: opts.schema ? { search_path: opts.schema } : {},
  });
}

export const toIso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export const json = (sql: Sql, value: unknown) => sql.json(value as Json);
