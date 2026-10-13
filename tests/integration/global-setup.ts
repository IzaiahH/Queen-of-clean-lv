import { execSync } from "node:child_process";
import postgres from "postgres";

/** Rebuilds the test database from the real migrations + base seed. Refuses to touch a non-test DB. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/qoc_test";
  const name = new URL(url).pathname.slice(1);
  if (!/_test$/.test(name)) throw new Error(`Refusing to reset "${name}": integration tests need a database whose name ends in _test.`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated;").catch(async () => {
    await sql.unsafe("drop schema if exists public cascade; create schema public;");
  });
  await sql.end();
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_DIRECT: url };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "pipe" });
  execSync("npx tsx scripts/seed.ts", { env, stdio: "pipe" });
}
