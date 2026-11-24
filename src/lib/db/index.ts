import "server-only";
import postgres from "postgres";
import { waitUntil } from "@vercel/functions";

type Sql = postgres.Sql<Record<string, unknown>>;
export type TxSql = postgres.TransactionSql<Record<string, unknown>>;
export type Tx = TxSql | Sql;

const globalForDb = globalThis as unknown as { __qocSql?: Sql };

// Seconds an unused connection stays open. Kept short on purpose (see keepInstanceAlive).
const IDLE_SECONDS = 5;

/**
 * On Vercel, a function instance is frozen between requests. A connection left open across a
 * freeze can be silently dropped by the network or Supabase's pooler; the next query on it then
 * hangs until the function times out (seen in production as 300-second timeouts).
 * After each use, we ask Vercel to keep the instance running a little longer than the idle
 * timeout so postgres.js closes its idle connections *before* the freeze. Outside Vercel
 * (local dev, scripts, tests) waitUntil does nothing and the timer is unref'd so it never
 * keeps a process alive.
 */
function keepInstanceAlive() {
  waitUntil(
    new Promise<void>((resolve) => {
      setTimeout(resolve, (IDLE_SECONDS + 1) * 1000).unref();
    }),
  );
}

export function createSql(url: string): Sql {
  return postgres(url, {
    // Production uses Supabase's session pooler (port 5432; see README). Prepared statements stay off so
    // the app also works through a transaction-mode pooler if one is ever used.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: IDLE_SECONDS,
    // Never reuse a connection for more than 5 minutes, as a second line of defence.
    max_lifetime: 60 * 5,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Keep calendar dates as plain "YYYY-MM-DD" strings; never shift them through a JS Date.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  }) as unknown as Sql;
}

/** Server-only connection. The connection string never reaches the browser. */
export function db(): Sql {
  if (!globalForDb.__qocSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example and README → Local setup.");
    globalForDb.__qocSql = createSql(url);
  }
  keepInstanceAlive();
  return globalForDb.__qocSql;
}
