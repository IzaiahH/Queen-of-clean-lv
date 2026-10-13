/**
 * Applies db/local-bootstrap.sql (idempotent; no-op on Supabase) and every file in
 * supabase/migrations in name order, once each. Usage: npm run db:migrate
 * Use a direct (non-pooled) connection string for migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadEnv } from "./env";

loadEnv();
const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or DATABASE_URL_DIRECT) first. See .env.example.");
  process.exit(1);
}

async function main() {
  const sql = postgres(url!, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(join(process.cwd(), "db/local-bootstrap.sql"), "utf8"));
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    await sql`alter table schema_migrations enable row level security`;
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      process.stdout.write(`Applying ${f} … `);
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, f), "utf8"));
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      console.log("done");
    }
    console.log("Database is up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
