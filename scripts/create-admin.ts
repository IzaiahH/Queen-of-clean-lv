/**
 * Creates (or re-activates) a staff account securely.
 *   npm run admin:create -- --email you@example.com --name "Your Name" [--role owner|admin|office]
 * The password is prompted for (or read from ADMIN_PASSWORD for automation) and never stored in plain text.
 * With AUTH_PROVIDER=supabase the user is created in Supabase Auth via the service-role key (server-side only).
 */
import { createInterface } from "node:readline/promises";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env";

loadEnv();
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("Password (min 12 characters): ");
  rl.close();
  return pw;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const role = arg("role") ?? "owner";
  if (!email || !name || !["owner", "admin", "office"].includes(role)) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--role owner|admin|office]');
    process.exit(1);
  }
  const password = await readPassword();
  if (password.length < 12) throw new Error("Use a password of at least 12 characters.");
  const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const provider = process.env.AUTH_PROVIDER ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local");
  try {
    let authUserId: string | null = null;
    let hash: string | null = null;
    if (provider === "supabase") {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to create Supabase users (keep it server-side only).");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      authUserId = data.user.id;
    } else {
      const salt = randomBytes(16);
      const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
      hash = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
    }
    await sql`
      insert into profiles (email, full_name, role, auth_user_id, password_hash, active)
      values (${email}, ${name}, ${role}, ${authUserId}, ${hash}, true)
      on conflict ((lower(email))) do update set full_name = excluded.full_name, role = excluded.role, active = true,
        auth_user_id = coalesce(excluded.auth_user_id, profiles.auth_user_id), password_hash = coalesce(excluded.password_hash, profiles.password_hash)`;
    await sql`insert into audit_logs (actor_label, action, entity_type, entity_id, details) values ('CLI', 'user.create', 'profile', ${email}, ${sql.json({ role, provider })})`;
    console.log(`${role} account ready for ${email} (${provider} auth). Sign in at /admin/login.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
