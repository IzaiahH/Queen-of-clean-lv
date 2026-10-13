import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { headers } from "next/headers";
import { db } from "@/lib/db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random secret (raw value goes to the customer; only its hash is stored). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReference(prefix: string): string {
  const b = randomBytes(6);
  let s = "";
  for (const byte of b) s += REF_ALPHABET[byte % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scrypt(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return sha256(`${ip}|${process.env.SESSION_SECRET ?? "qoc"}`).slice(0, 32);
}

/**
 * Fixed-window rate limit stored in Postgres so it works across serverless instances.
 * Returns true when the request is allowed.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const sql = db();
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (bucket, window_start, count) values (${bucket}, ${windowStart}, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (Math.random() < 0.02) await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  return row.count <= limit;
}
