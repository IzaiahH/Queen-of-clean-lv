import { beforeAll, describe, expect, it } from "vitest";
import { issueRecoveryTicket, RECOVERY_TICKET_MINUTES, verifyRecoveryTicket } from "@/lib/auth/recovery";

const user = "11111111-2222-3333-4444-555555555555";
const other = "99999999-2222-3333-4444-555555555555";
const t0 = Date.UTC(2026, 10, 24, 20, 0, 0);

beforeAll(() => {
  process.env.SESSION_SECRET = "unit-test-secret-not-real-0123456789";
});

describe("password recovery ticket", () => {
  it("accepts a fresh ticket for the same account", () => {
    const { value } = issueRecoveryTicket(user, t0);
    expect(verifyRecoveryTicket(value, user, t0 + 60_000)).toBe(true);
  });

  it("rejects a ticket for a different account", () => {
    const { value } = issueRecoveryTicket(user, t0);
    expect(verifyRecoveryTicket(value, other, t0)).toBe(false);
  });

  it("expires", () => {
    const { value, expires } = issueRecoveryTicket(user, t0);
    expect(expires.getTime()).toBe(t0 + RECOVERY_TICKET_MINUTES * 60_000);
    expect(verifyRecoveryTicket(value, user, expires.getTime())).toBe(false);
  });

  it("rejects missing, malformed and tampered tickets", () => {
    const { value } = issueRecoveryTicket(user, t0);
    const [id, , mac] = value.split(".");
    expect(verifyRecoveryTicket(undefined, user, t0)).toBe(false);
    expect(verifyRecoveryTicket("garbage", user, t0)).toBe(false);
    expect(verifyRecoveryTicket(`${id}.${t0 + 10 * 86400_000}.${mac}`, user, t0)).toBe(false); // extended expiry
    expect(verifyRecoveryTicket(`${value}x`, user, t0)).toBe(false);
  });

  it("is invalidated by changing SESSION_SECRET", () => {
    const { value } = issueRecoveryTicket(user, t0);
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-different-secret-0123456789abcdef";
    expect(verifyRecoveryTicket(value, user, t0)).toBe(false);
    process.env.SESSION_SECRET = prev;
  });
});
