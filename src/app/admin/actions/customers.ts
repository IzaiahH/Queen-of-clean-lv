"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/server/audit";
import {
  createCustomer, deleteProperty, findDuplicates, mergeCustomers, saveProperty, updateCustomer,
  type CustomerInput, type PropertyEdit,
} from "@/lib/server/customers";
import { guard } from "./guard";

const uuid = z.string().uuid();

function zodMessage(e: unknown) {
  if (e instanceof z.ZodError) return e.issues.map((i) => i.message).join("; ");
  return null;
}

export async function createCustomerAction(input: CustomerInput, property: PropertyEdit | null, allowDuplicate: boolean) {
  return guard("customers.edit", async (_u, actor) => {
    try {
      if (!allowDuplicate) {
        const dups = await findDuplicates(db(), { email: input.email || null, phone: input.phone || null, full_name: input.full_name });
        if (dups.length) return { ok: false, error: "Possible duplicate", conflicts: dups.map((d) => `${d.reason}: ${d.full_name}${d.email ? ` (${d.email})` : ""}`) };
      }
      const id = await createCustomer(actor, input, property);
      return { ok: true, message: "Customer added.", data: { id } };
    } catch (e) {
      const m = zodMessage(e);
      if (m) return { ok: false, error: m };
      throw e;
    }
  });
}

export async function updateCustomerAction(id: string, input: CustomerInput) {
  return guard("customers.edit", async (_u, actor) => {
    try {
      await updateCustomer(actor, uuid.parse(id), input);
      return { ok: true, message: "Customer saved." };
    } catch (e) {
      const m = zodMessage(e);
      if (m) return { ok: false, error: m };
      throw e;
    }
  });
}

export async function saveCustomerStatusAction(id: string, status: "active" | "inactive" | "archived" | "lead") {
  return guard("customers.edit", async (_u, actor) => {
    await db()`update customers set status = ${z.enum(["active", "inactive", "archived", "lead"]).parse(status)} where id = ${uuid.parse(id)} and merged_into_id is null`;
    await audit(actor, `customer.${status === "archived" ? "archive" : "status"}`, "customer", id, { status });
    return { ok: true, message: status === "archived" ? "Customer archived. Their history is kept." : "Status updated." };
  });
}

export async function savePropertyAction(customerId: string, propertyId: string | null, input: PropertyEdit) {
  return guard("customers.edit", async (_u, actor) => {
    try {
      await saveProperty(actor, uuid.parse(customerId), propertyId ? uuid.parse(propertyId) : null, input);
      return { ok: true, message: "Property saved." };
    } catch (e) {
      const m = zodMessage(e);
      if (m) return { ok: false, error: m };
      throw e;
    }
  });
}

export async function deletePropertyAction(customerId: string, propertyId: string) {
  return guard("customers.edit", async (_u, actor) => {
    const r = await deleteProperty(actor, uuid.parse(customerId), uuid.parse(propertyId));
    return r.ok ? { ok: true, message: "Property removed." } : r;
  });
}

export async function mergeCustomersAction(keepId: string, mergeId: string) {
  return guard("customers.merge", async (_u, actor) => {
    const r = await mergeCustomers(actor, uuid.parse(keepId), uuid.parse(mergeId));
    return r.ok ? { ok: true, message: "Records merged. The duplicate was archived." } : r;
  });
}

export async function recordPaymentAction(input: { customer_id: string; appointment_id: string | null; amount_cents: number; method: string; received_on: string; notes: string }) {
  return guard("finance.edit", async (user, actor) => {
    const d = z.object({
      customer_id: uuid, appointment_id: uuid.nullable(), amount_cents: z.number().int().min(1).max(10_000_000),
      method: z.enum(["cash", "card", "zelle", "venmo", "check", "stripe", "other"]), received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(500),
    }).parse(input);
    const [row] = await db()<{ id: string }[]>`
      insert into payments (customer_id, appointment_id, amount_cents, method, received_at, notes, recorded_by)
      values (${d.customer_id}, ${d.appointment_id}, ${d.amount_cents}, ${d.method}, ${`${d.received_on}T12:00:00Z`}, ${d.notes}, ${user.id}) returning id`;
    if (d.appointment_id) {
      await db()`
        update appointments a set payment_status = case
            when (select coalesce(sum(amount_cents),0) from payments p where p.appointment_id = a.id) >= coalesce((select revenue_cents from job_records j where j.appointment_id = a.id), a.agreed_price_cents) then 'paid'
            else 'partial' end
         where a.id = ${d.appointment_id}`;
    }
    await audit(actor, "payment.record", "payment", row.id, { amount_cents: d.amount_cents, method: d.method });
    return { ok: true, message: "Payment recorded." };
  });
}

export async function deletePaymentAction(id: string) {
  return guard("finance.edit", async (_u, actor) => {
    const [p] = await db()<{ appointment_id: string | null; amount_cents: number }[]>`delete from payments where id = ${uuid.parse(id)} returning appointment_id, amount_cents`;
    if (p?.appointment_id)
      await db()`update appointments set payment_status = case when exists (select 1 from payments where appointment_id = ${p.appointment_id}) then 'partial' else 'unpaid' end where id = ${p.appointment_id}`;
    await audit(actor, "payment.delete", "payment", id, { amount_cents: p?.amount_cents });
    return { ok: true, message: "Payment removed." };
  });
}

export async function contactMessageStatusAction(id: string, status: "new" | "handled" | "spam") {
  return guard("customers.edit", async (_u, actor) => {
    await db()`update contact_messages set status = ${z.enum(["new", "handled", "spam"]).parse(status)} where id = ${uuid.parse(id)}`;
    await audit(actor, "contact_message.status", "contact_message", id, { status });
    return { ok: true, message: "Updated." };
  });
}

/** Turns a website contact message into a lead record (no address needed yet). */
export async function contactToCustomerAction(id: string) {
  return guard("customers.edit", async (_u, actor) => {
    const [m] = await db()<{ name: string; email: string; phone: string | null; message: string }[]>`select name, email, phone, message from contact_messages where id = ${uuid.parse(id)}`;
    if (!m) return { ok: false, error: "Message not found" };
    const dups = await findDuplicates(db(), { email: m.email, phone: m.phone, full_name: m.name });
    const exact = dups.find((d) => d.reason === "Same email");
    if (exact) {
      await db()`update contact_messages set status = 'handled' where id = ${id}`;
      return { ok: true, message: "This person is already a customer.", data: { id: exact.id } };
    }
    const cid = await createCustomer(actor, {
      full_name: m.name, email: m.email, phone: m.phone ?? "", preferred_contact: "email", status: "lead", preferences: "",
      private_notes: `From website message: ${m.message.slice(0, 2000)}`, source: "website", marketing_consent: false,
    }, null);
    await db()`update contact_messages set status = 'handled' where id = ${id}`;
    return { ok: true, message: "Lead created from the message.", data: { id: cid } };
  });
}
