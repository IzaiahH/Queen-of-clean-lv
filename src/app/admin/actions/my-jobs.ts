"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { recordChange } from "@/lib/server/schedule";
import { guard } from "./guard";

const uuid = z.string().uuid();

/** Cleaners can only touch jobs they're assigned to; checked in SQL, not just hidden in the UI. */
async function assigned(cleanerId: string | null, appointmentId: string) {
  if (!cleanerId) return false;
  const [r] = await db()`select 1 from appointment_assignments where cleaner_id = ${cleanerId} and appointment_id = ${appointmentId}`;
  return Boolean(r);
}

export async function clockAction(appointmentId: string, kind: "clock_in" | "clock_out") {
  return guard("jobs.own", async (user, actor) => {
    const id = uuid.parse(appointmentId);
    if (!(await assigned(user.cleaner_id, id))) return { ok: false, error: "This job isn't assigned to you." };
    await db().begin((tx) => recordChange(tx, id, z.enum(["clock_in", "clock_out"]).parse(kind), actor, null, { at: new Date().toISOString(), cleaner_id: user.cleaner_id }));
    return { ok: true, message: kind === "clock_in" ? "Clocked in." : "Clocked out." };
  });
}

export async function reportDoneAction(appointmentId: string, checklist: string[], note: string) {
  return guard("jobs.own", async (user, actor) => {
    const id = uuid.parse(appointmentId);
    if (!(await assigned(user.cleaner_id, id))) return { ok: false, error: "This job isn't assigned to you." };
    const done = z.array(z.string().max(200)).max(100).parse(checklist);
    await db().begin(async (tx) => {
      await recordChange(tx, id, "cleaner_report", actor, null, { checklist_done: done, cleaner_id: user.cleaner_id }, z.string().max(2000).parse(note));
      await tx`update appointments set needs_attention = 'Cleaner reported job done. Review and complete.' where id = ${id} and status in ('pending','confirmed')`;
    });
    return { ok: true, message: "Sent to the office. Thank you!" };
  });
}
