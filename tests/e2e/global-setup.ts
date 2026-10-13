import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";
import { loadEnv } from "../../scripts/env";
import { CLEANER, OWNER } from "./accounts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
async function hash(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Ensures a synthetic owner and a cleaner login (with working hours) exist. Local auth + local/staging DB only. */
export default async function setup() {
  loadEnv();
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (or E2E_DATABASE_URL) to the database the app under test uses.");
  if (!/localhost|127\.0\.0\.1/.test(url) && process.env.E2E_ALLOW_REMOTE_DB !== "1") throw new Error("Refusing to add test accounts to a non-local database without E2E_ALLOW_REMOTE_DB=1.");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`delete from rate_limits where bucket like 'login:%' or bucket like 'booking:%'`;
    // Remove synthetic customers left by earlier runs (only the e2e.*@example.test addresses this suite creates).
    const old = sql`select id from customers where email like 'e2e.%@example.test'`;
    await sql`delete from communications where customer_id in (${old})`;
    await sql`delete from appointments where customer_id in (${old})`;
    await sql`delete from quotes where customer_id in (${old})`;
    await sql`delete from customers where email like 'e2e.%@example.test'`;
    const ownerHash = await hash(OWNER.password);
    await sql`insert into profiles (email, full_name, role, password_hash) values (${OWNER.email}, 'E2E Owner', 'owner', ${ownerHash})
              on conflict (lower(email)) do update set password_hash = excluded.password_hash, active = true, role = 'owner'`;
    let [cleaner] = await sql<{ id: string }[]>`select id from cleaners where email = ${CLEANER.email}`;
    if (!cleaner) {
      [cleaner] = await sql<{ id: string }[]>`insert into cleaners (full_name, email, color, worker_type, pay_method, pay_rate_cents, max_jobs_per_day)
        values (${CLEANER.name}, ${CLEANER.email}, '#2F5D62', 'unspecified', 'hourly', 2200, 4) returning id`;
      for (const wd of [1, 2, 3, 4, 5]) await sql`insert into cleaner_working_hours (cleaner_id, weekday, start_time, end_time) values (${cleaner.id}, ${wd}, '08:00', '17:00')`;
    }
    await sql`update cleaners set active = true where id = ${cleaner.id}`;
    const cleanerHash = await hash(CLEANER.password);
    await sql`insert into profiles (email, full_name, role, cleaner_id, password_hash) values (${CLEANER.email}, ${CLEANER.name}, 'cleaner', ${cleaner.id}, ${cleanerHash})
              on conflict (lower(email)) do update set password_hash = excluded.password_hash, active = true, role = 'cleaner', cleaner_id = excluded.cleaner_id`;
  } finally {
    await sql.end();
  }
}
