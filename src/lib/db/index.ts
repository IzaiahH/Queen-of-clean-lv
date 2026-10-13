import "server-only";
import postgres from "postgres";

type Sql = postgres.Sql<Record<string, unknown>>;
export type TxSql = postgres.TransactionSql<Record<string, unknown>>;
export type Tx = TxSql | Sql;

const globalForDb = globalThis as unknown as { __qocSql?: Sql };

export function createSql(url: string): Sql {
  return postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
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
  return globalForDb.__qocSql;
}
