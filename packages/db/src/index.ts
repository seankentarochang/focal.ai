import { connect, type ConnectOptions, type Sql } from "./client";
import { layoutsRepo, pageResultsRepo, profileRepo, resolutionsRepo, sitesRepo, usersRepo } from "./repos";

export * from "./types";
export { connect, type Sql, type ConnectOptions } from "./client";
export { migrate, loadMigrations, MIGRATIONS_DIR, type Migration } from "./migrate";
export { PAGE_RESULT_TTL_MS } from "./repos";

export function createDb(sql: Sql) {
  return {
    sql,
    users: usersRepo(sql),
    profile: profileRepo(sql),
    sites: sitesRepo(sql),
    layouts: layoutsRepo(sql),
    resolutions: resolutionsRepo(sql),
    pageResults: pageResultsRepo(sql),
    close: () => sql.end(),
  };
}

export type Db = ReturnType<typeof createDb>;

export function openDb(url: string, opts?: ConnectOptions): Db {
  return createDb(connect(url, opts));
}
