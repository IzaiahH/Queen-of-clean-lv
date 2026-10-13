"use server";

import { DateTime } from "luxon";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { audit } from "@/lib/server/audit";
import { saveCleaner, saveHours, type CleanerInput } from "@/lib/server/cleaners";
import { loadSettings } from "@/lib/server/settings";
import { createStaffAccount, resetStaffPassword, updateStaffAccount } from "@/lib/server/staff";
import { guard } from "./guard";

const uuid = z.string().uuid();

export async function saveCleanerAction(id: string | null, input: CleanerInput) {
  return guard("cleaners.edit", async (user, actor) => {
    const cid = await saveCleaner(actor, id ? uuid.parse(id) : null, input, can(user.role, "cleaners.pay"));
    return { ok: true, message: id ? "Cleaner saved." : "Cleaner added. Set their working hours next.", data: { id: cid } };
  });
}

export async function saveHoursAction(cleanerId: string, rows: { weekday: number; start_time: string; end_time: string }[]) {
  return guard("cleaners.edit", async (_u, actor) => {
    await saveHours(actor, uuid.parse(cleanerId), rows);
    return { ok: true, message: "Working hours saved. Online booking uses them right away." };
  });
}

export async function addTimeOffAction(cleanerId: string, startDate: string, endDate: string, reason: string, force: boolean) {
  return guard("cleaners.edit", async (_u, actor) => {
    const tz = (await loadSettings()).booking.timezone;
    const s = DateTime.fromISO(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(startDate), { zone: tz }).startOf("day");
    const e = DateTime.fromISO(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(endDate), { zone: tz }).endOf("day");
    if (e <= s) return { ok: false, error: "End date must be on or after the start date." };
    const clashes = await db()<{ starts_at: Date; customer: string }[]>`
      select a.starts_at, c.full_name as customer from appointment_assignments x join appointments a on a.id = x.appointment_id join customers c on c.id = a.customer_id
       where x.cleaner_id = ${uuid.parse(cleanerId)} and a.status in ('pending','confirmed') and a.starts_at < ${e.toJSDate()} and a.ends_at > ${s.toJSDate()} order by a.starts_at`;
    if (clashes.length && !force)
      return { ok: false, error: "Assigned jobs during this time", conflicts: clashes.map((x) => `${DateTime.fromJSDate(x.starts_at).setZone(tz).toFormat("ccc LLL d, h:mm a")}: ${x.customer} (reassign this job)`) };
    const [row] = await db()<{ id: string }[]>`insert into cleaner_time_off (cleaner_id, starts_at, ends_at, reason) values (${cleanerId}, ${s.toJSDate()}, ${e.toJSDate()}, ${z.string().max(200).parse(reason)}) returning id`;
    if (clashes.length)
      await db()`update appointments a set needs_attention = 'Assigned cleaner is off' from appointment_assignments x
                  where x.appointment_id = a.id and x.cleaner_id = ${cleanerId} and a.status in ('pending','confirmed') and a.starts_at < ${e.toJSDate()} and a.ends_at > ${s.toJSDate()}`;
    await audit(actor, "cleaner.time_off", "cleaner", cleanerId, { id: row.id, clashes: clashes.length });
    return { ok: true, message: clashes.length ? "Time off saved. Affected jobs are flagged as needing attention." : "Time off saved." };
  });
}

export async function deleteTimeOffAction(id: string) {
  return guard("cleaners.edit", async (_u, actor) => {
    await db()`delete from cleaner_time_off where id = ${uuid.parse(id)}`;
    await audit(actor, "cleaner.time_off_delete", "cleaner_time_off", id);
    return { ok: true, message: "Time off removed." };
  });
}

export async function createStaffAction(input: { email: string; full_name: string; role: "owner" | "admin" | "office" | "cleaner"; cleaner_id: string | null; password: string }) {
  return guard("users.manage", async (_u, actor) => {
    const r = await createStaffAccount(actor, input);
    return r.ok ? { ok: true, message: "Account created. Share the temporary password privately (not by email subject or text preview)." } : r;
  });
}

export async function updateStaffAction(id: string, input: { role: "owner" | "admin" | "office" | "cleaner"; active: boolean; cleaner_id: string | null; full_name: string }) {
  return guard("users.manage", async (user, actor) => {
    if (id === user.id && (!input.active || input.role !== user.role)) return { ok: false, error: "You can't change your own role or deactivate yourself." };
    const r = await updateStaffAccount(actor, uuid.parse(id), input);
    return r.ok ? { ok: true, message: "Account updated." } : r;
  });
}

export async function resetPasswordAction(id: string, password: string) {
  return guard("users.manage", async (_u, actor) => {
    const r = await resetStaffPassword(actor, uuid.parse(id), password);
    return r.ok ? { ok: true, message: "Password changed. They've been signed out everywhere." } : r;
  });
}
