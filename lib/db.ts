import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let client: Sql | null = null;

function connect(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  // `prepare: false` is required by transaction-mode connection poolers
  // (Supabase's pooler, PgBouncer). Harmless on a direct connection.
  client = postgres(url, { ssl: "require", max: 5, prepare: false });
  return client;
}

/**
 * Connects on first use, not on import.
 *
 * Next.js evaluates every route module during `next build`, so connecting at
 * import time makes the build fail on a fresh clone with no database yet.
 * Someone should be able to clone this repo and run the tests and a build
 * before they have signed up for anything.
 */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (connect() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop: string | symbol) {
    return (connect() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as Sql;

/** Identifies which posting this deployment screens. Any stable string. */
export const JOB_EXTERNAL_ID = process.env.JOB_ID ?? "default";
