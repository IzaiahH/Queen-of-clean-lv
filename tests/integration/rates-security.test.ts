import { describe, expect, it } from "vitest";
import { db, type TxSql } from "@/lib/db";

/**
 * Database-level protection of customer-specific rates (row-level security), independent of the app.
 * Supabase grants table access to its `anon` and `authenticated` roles by default, so this simulates
 * those grants and checks RLS alone. Everything runs in a transaction that is always rolled back.
 */
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OFFICE = "00000000-0000-0000-0000-00000000000b";
const CLEANER = "00000000-0000-0000-0000-00000000000c";
const CUSTOMER = "00000000-0000-0000-0000-0000000000f1";

class Rollback extends Error {}

async function inRolledBackTx(fn: (tx: TxSql) => Promise<void>) {
  await db()
    .begin(async (tx) => {
      await tx`grant select, insert, update, delete on customers, customer_rates, profiles to authenticated, anon`;
      await tx`insert into profiles (auth_user_id, email, full_name, role) values
        (${ADMIN}, 'rls.admin@example.test', 'RLS Admin', 'admin'),
        (${OFFICE}, 'rls.office@example.test', 'RLS Office', 'office'),
        (${CLEANER}, 'rls.cleaner@example.test', 'RLS Cleaner', 'cleaner')`;
      await tx`insert into customers (id, full_name, status, source) values (${CUSTOMER}, 'RLS Fictional', 'unverified', 'import')`;
      await tx`insert into customer_rates (customer_id, frequency, price_cents, kind, source) values (${CUSTOMER}, 'monthly', 12345, 'historical', 'import')`;
      await fn(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
}

describe("customer rates: database permissions", () => {
  it("office staff can read rates but cannot change, add or delete them", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${OFFICE}, true)`;
      expect((await tx`select id from customer_rates`).length).toBe(1);
      expect((await tx`update customer_rates set price_cents = 1`).count).toBe(0);
      expect((await tx`delete from customer_rates`).count).toBe(0);
      await expect(
        tx.savepoint((sp) => sp`insert into customer_rates (customer_id, frequency, price_cents, kind, source) values (${CUSTOMER}, 'weekly', 1, 'custom', 'admin')`),
      ).rejects.toThrow(/row-level security/);
      await tx`reset role`;
      const [r] = await tx<{ price_cents: number }[]>`select price_cents from customer_rates where customer_id = ${CUSTOMER}`;
      expect(r.price_cents).toBe(12345);
    });
  });

  it("cleaners and the public see no rates at all", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${CLEANER}, true)`;
      expect((await tx`select id from customer_rates`).length).toBe(0);
      await tx`reset role`;
      await tx`set local role anon`;
      expect((await tx`select id from customer_rates`).length).toBe(0);
    });
  });

  it("owners and admins can change rates", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${ADMIN}, true)`;
      expect((await tx`update customer_rates set notes = 'checked'`).count).toBe(1);
    });
  });

  it("the anon role has no table access to rates as migrated", async () => {
    const [p] = await db()<{ ok: boolean }[]>`select has_table_privilege('anon', 'customer_rates', 'select') as ok`;
    expect(p.ok).toBe(false);
  });
});
