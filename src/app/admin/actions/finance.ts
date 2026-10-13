"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/server/audit";
import { guard } from "./guard";

const expense = z.object({
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  category: z.enum(["supplies", "mileage", "software", "equipment", "marketing", "insurance", "labor_other", "other"]),
  amount_cents: z.number().int().min(1, "Enter an amount").max(10_000_000),
  description: z.string().trim().max(500),
  is_estimate: z.boolean(),
});

export async function saveExpenseAction(id: string | null, input: z.input<typeof expense>) {
  return guard("finance.edit", async (user, actor) => {
    const d = expense.parse(input);
    if (id) {
      await db()`update expenses set spent_on = ${d.spent_on}, category = ${d.category}, amount_cents = ${d.amount_cents}, description = ${d.description}, is_estimate = ${d.is_estimate} where id = ${z.string().uuid().parse(id)}`;
      await audit(actor, "expense.update", "expense", id, { amount_cents: d.amount_cents });
    } else {
      const [row] = await db()<{ id: string }[]>`insert into expenses (spent_on, category, amount_cents, description, is_estimate, created_by) values (${d.spent_on}, ${d.category}, ${d.amount_cents}, ${d.description}, ${d.is_estimate}, ${user.id}) returning id`;
      await audit(actor, "expense.create", "expense", row.id, { amount_cents: d.amount_cents });
    }
    return { ok: true, message: "Expense saved." };
  });
}

export async function deleteExpenseAction(id: string) {
  return guard("finance.edit", async (_u, actor) => {
    const [row] = await db()<{ amount_cents: number }[]>`delete from expenses where id = ${z.string().uuid().parse(id)} returning amount_cents`;
    await audit(actor, "expense.delete", "expense", id, { amount_cents: row?.amount_cents });
    return { ok: true, message: "Expense deleted." };
  });
}
