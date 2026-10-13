import { DateTime, Interval } from "luxon";

export type DayHours = { open: string; close: string } | null;
/** ISO weekday (1 = Monday … 7 = Sunday) → hours, or null when closed. */
export type OperatingHours = Record<string, DayHours>;

export type SchedulingConfig = {
  tz: string;
  operating_hours: OperatingHours;
  slot_interval_minutes: number;
  lead_time_hours: number;
  travel_buffer_minutes: number;
  max_jobs_per_day: number;
  horizon_days: number;
};

export type CleanerSchedule = {
  id: string;
  name: string;
  capabilities: string[]; // empty = can do every service
  max_jobs_per_day: number | null;
  hours: { weekday: number; start: string; end: string }[];
  time_off: { starts_at: string; ends_at: string }[];
};

export type BusyAppointment = { id: string; starts_at: string; ends_at: string; cleaner_ids: string[] };
export type BlockedPeriod = { starts_at: string; ends_at: string; reason?: string };

export type ScheduleContext = {
  config: SchedulingConfig;
  cleaners: CleanerSchedule[];
  busy: BusyAppointment[]; // pending + confirmed (+ completed) appointments only
  blocked: BlockedPeriod[];
};

export type Slot = { start: string; end: string; label: string; cleaner_ids: string[] };
export type DaySlots = { date: string; label: string; slots: Slot[] };

const iv = (a: string, b: string) => Interval.fromDateTimes(DateTime.fromISO(a), DateTime.fromISO(b));

function overlaps(aStart: DateTime, aEnd: DateTime, bStart: DateTime, bEnd: DateTime) {
  return aStart < bEnd && bStart < aEnd;
}

function localDay(dt: DateTime, tz: string) {
  return dt.setZone(tz).toISODate()!;
}

function withinDayHours(start: DateTime, end: DateTime, tz: string, open: string, close: string) {
  const s = start.setZone(tz);
  const day = s.toISODate()!;
  const o = DateTime.fromISO(`${day}T${open}`, { zone: tz });
  const c = DateTime.fromISO(`${day}T${close}`, { zone: tz });
  return start >= o && end <= c;
}

function jobsOnDay(busy: BusyAppointment[], day: string, tz: string, cleanerId?: string, excludeId?: string) {
  return busy.filter(
    (b) =>
      b.id !== excludeId &&
      localDay(DateTime.fromISO(b.starts_at), tz) === day &&
      (cleanerId === undefined || b.cleaner_ids.includes(cleanerId)),
  ).length;
}

export type CleanerCheck = { cleaner_id: string; ok: boolean; problems: string[] };

/** Why (or whether) one cleaner can take a job in this window. */
export function checkCleaner(
  ctx: ScheduleContext,
  cleaner: CleanerSchedule,
  start: DateTime,
  end: DateTime,
  opts: { serviceSlug?: string; excludeAppointmentId?: string } = {},
): CleanerCheck {
  const { tz, travel_buffer_minutes } = ctx.config;
  const problems: string[] = [];
  if (opts.serviceSlug && cleaner.capabilities.length > 0 && !cleaner.capabilities.includes(opts.serviceSlug))
    problems.push(`${cleaner.name} isn't set up for this service`);
  const weekday = start.setZone(tz).weekday;
  const shifts = cleaner.hours.filter((h) => h.weekday === weekday);
  if (!shifts.some((h) => withinDayHours(start, end, tz, h.start, h.end))) problems.push(`Outside ${cleaner.name}'s working hours`);
  if (cleaner.time_off.some((t) => iv(t.starts_at, t.ends_at).overlaps(Interval.fromDateTimes(start, end))))
    problems.push(`${cleaner.name} has time off`);
  const bStart = start.minus({ minutes: travel_buffer_minutes });
  const bEnd = end.plus({ minutes: travel_buffer_minutes });
  const clash = ctx.busy.find(
    (b) =>
      b.id !== opts.excludeAppointmentId &&
      b.cleaner_ids.includes(cleaner.id) &&
      overlaps(bStart, bEnd, DateTime.fromISO(b.starts_at), DateTime.fromISO(b.ends_at)),
  );
  if (clash) problems.push(`${cleaner.name} is booked within the travel buffer of another job`);
  if (cleaner.max_jobs_per_day != null) {
    const n = jobsOnDay(ctx.busy, localDay(start, tz), tz, cleaner.id, opts.excludeAppointmentId);
    if (n >= cleaner.max_jobs_per_day) problems.push(`${cleaner.name} already has ${n} job(s) that day`);
  }
  return { cleaner_id: cleaner.id, ok: problems.length === 0, problems };
}

export type SlotCheck = { ok: boolean; cleaner_ids: string[]; problems: string[] };

/**
 * Whether a new job fits in [start, end). Business-wide rules first, then cleaner capacity.
 * Appointments with no cleaner yet still consume one cleaner's worth of capacity.
 */
export function checkSlot(
  ctx: ScheduleContext,
  start: DateTime,
  end: DateTime,
  opts: { serviceSlug?: string; excludeAppointmentId?: string; now?: DateTime; enforceLeadTime?: boolean } = {},
): SlotCheck {
  const { config } = ctx;
  const problems: string[] = [];
  const tz = config.tz;
  const day = localDay(start, tz);
  const hours = config.operating_hours[String(start.setZone(tz).weekday)];
  if (!hours) problems.push("The business is closed that day");
  else if (!withinDayHours(start, end, tz, hours.open, hours.close)) problems.push("Outside business hours");
  if (opts.enforceLeadTime) {
    const now = opts.now ?? DateTime.now();
    if (start < now.plus({ hours: config.lead_time_hours })) problems.push(`Bookings need at least ${config.lead_time_hours} hours' notice`);
    if (start > now.plus({ days: config.horizon_days })) problems.push("That date is beyond the booking window");
  }
  const blocked = ctx.blocked.find((b) => overlaps(start, end, DateTime.fromISO(b.starts_at), DateTime.fromISO(b.ends_at)));
  if (blocked) problems.push(blocked.reason ? `Blocked: ${blocked.reason}` : "That time is blocked on the calendar");
  if (jobsOnDay(ctx.busy, day, tz, undefined, opts.excludeAppointmentId) >= config.max_jobs_per_day)
    problems.push("The daily job limit has been reached");

  const checks = ctx.cleaners.map((c) => checkCleaner(ctx, c, start, end, opts));
  const free = checks.filter((c) => c.ok).map((c) => c.cleaner_id);
  const bStart = start.minus({ minutes: config.travel_buffer_minutes });
  const bEnd = end.plus({ minutes: config.travel_buffer_minutes });
  const unassigned = ctx.busy.filter(
    (b) =>
      b.id !== opts.excludeAppointmentId &&
      b.cleaner_ids.length === 0 &&
      overlaps(bStart, bEnd, DateTime.fromISO(b.starts_at), DateTime.fromISO(b.ends_at)),
  ).length;
  if (ctx.cleaners.length === 0) problems.push("No cleaners are scheduled");
  else if (free.length - unassigned < 1) problems.push("No cleaner is available for the full appointment");

  // Prefer the cleaner with the lightest day.
  const load = (id: string) => jobsOnDay(ctx.busy, day, tz, id, opts.excludeAppointmentId);
  free.sort((a, b) => load(a) - load(b) || a.localeCompare(b));
  return { ok: problems.length === 0, cleaner_ids: problems.length === 0 ? free : [], problems };
}

/** Real, bookable start times for each day in the range. */
export function listSlots(
  ctx: ScheduleContext,
  fromDate: string,
  days: number,
  durationMinutes: number,
  opts: { serviceSlug?: string; now?: DateTime } = {},
): DaySlots[] {
  const { tz, slot_interval_minutes } = ctx.config;
  const now = opts.now ?? DateTime.now();
  const out: DaySlots[] = [];
  const first = DateTime.fromISO(fromDate, { zone: tz }).startOf("day");
  for (let i = 0; i < days; i++) {
    const day = first.plus({ days: i });
    const date = day.toISODate()!;
    const hours = ctx.config.operating_hours[String(day.weekday)];
    const slots: Slot[] = [];
    if (hours) {
      let t = DateTime.fromISO(`${date}T${hours.open}`, { zone: tz });
      const close = DateTime.fromISO(`${date}T${hours.close}`, { zone: tz });
      while (t.plus({ minutes: durationMinutes }) <= close) {
        const end = t.plus({ minutes: durationMinutes });
        const res = checkSlot(ctx, t, end, { ...opts, now, enforceLeadTime: true });
        if (res.ok) slots.push({ start: t.toUTC().toISO()!, end: end.toUTC().toISO()!, label: t.toFormat("h:mm a"), cleaner_ids: res.cleaner_ids });
        t = t.plus({ minutes: slot_interval_minutes });
      }
    }
    out.push({ date, label: day.toFormat("ccc, LLL d"), slots });
  }
  return out;
}
