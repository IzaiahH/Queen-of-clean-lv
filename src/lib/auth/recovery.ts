import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived "this person just proved they own the inbox" ticket.
 *
 * Opening a password-recovery link gives the browser a normal Supabase session. Without this
 * ticket, anyone already signed in could open the reset page and change the password without
 * knowing the current one. The ticket is issued only right after a recovery link is verified,
 * is tied to that one account, and expires after RECOVERY_TICKET_MINUTES.
 */
export const RECOVERY_COOKIE = "qoc_pw_recovery";
export const RECOVERY_TICKET_MINUTES = 15;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ characters) for password recovery.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`pw-recovery|${payload}`).digest("base64url");
}

export function issueRecoveryTicket(authUserId: string, now = Date.now()): { value: string; expires: Date } {
  const expiresAt = now + RECOVERY_TICKET_MINUTES * 60_000;
  const payload = `${authUserId}.${expiresAt}`;
  return { value: `${payload}.${sign(payload)}`, expires: new Date(expiresAt) };
}

export function verifyRecoveryTicket(ticket: string | undefined, authUserId: string, now = Date.now()): boolean {
  if (!ticket) return false;
  const parts = ticket.split(".");
  if (parts.length !== 3) return false;
  const [id, exp, mac] = parts;
  if (id !== authUserId) return false;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
