"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import { DateTime } from "luxon";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CalendarPlus, ChevronLeft, ChevronRight, Loader2, Repeat, Search, SlidersHorizontal } from "lucide-react";
import { appointmentPanelAction, createBlockAction, deleteBlockAction } from "@/app/admin/actions/calendar";
import { rescheduleAction } from "@/app/admin/actions/appointments";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { AppointmentPanel, type AppointmentDetail, type CleanerOption } from "./AppointmentPanel";
import { NewAppointmentDialog, type ServiceOption } from "./NewAppointmentDialog";

type View = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
const VIEWS: { v: View; l: string; key: string }[] = [
  { v: "dayGridMonth", l: "Month", key: "month" },
  { v: "timeGridWeek", l: "Week", key: "week" },
  { v: "timeGridDay", l: "Day", key: "day" },
  { v: "listWeek", l: "Agenda", key: "agenda" },
];
const STATUSES = [
  { v: "pending", l: "Pending" },
  { v: "confirmed", l: "Confirmed" },
  { v: "completed", l: "Completed" },
  { v: "cancelled", l: "Cancelled" },
  { v: "declined", l: "Declined" },
  { v: "no_show", l: "No-show" },
];

type Move = { id: string; title: string; start: Date; end: Date; oldStart: Date; revert: () => void; conflicts?: string[] };

export function CalendarView({ tz, services, cleaners, areas, businessHours, canMoney, defaultChecklist }: {
  tz: string; services: ServiceOption[]; cleaners: CleanerOption[]; areas: { id: string; name: string }[];
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[]; canMoney: boolean; defaultChecklist: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const cal = useRef<FullCalendar>(null);
  const [view, setView] = useState<View>("timeGridWeek");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ cleaner: "", service: "", area: "", status: ["pending", "confirmed", "completed"] as string[], q: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [blockMode, setBlockMode] = useState(false);
  const [panel, setPanel] = useState<{ id: string; detail: AppointmentDetail | null } | null>(null);
  const [create, setCreate] = useState<{ start: string | null; minutes: number | null } | null>(null);
  const [block, setBlock] = useState<{ start: Date; end: Date; reason: string } | null>(null);
  const [blockToDelete, setBlockToDelete] = useState<{ id: string; title: string } | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [notifyMove, setNotifyMove] = useState(true);
  const [saving, setSaving] = useState(false);

  // Phones open on the agenda or day view; ?view= and ?new=1 deep links from the dashboard.
  // Reads the URL and screen size once after mount (both unavailable during server render).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const requested = VIEWS.find((x) => x.key === params.get("view"))?.v;
    const initial = requested ?? (window.matchMedia("(max-width: 767px)").matches ? "listWeek" : "timeGridWeek");
    setView(initial);
    cal.current?.getApi().changeView(initial);
    if (params.get("new") === "1") setCreate({ start: null, minutes: null });
    const date = params.get("date");
    if (date) cal.current?.getApi().gotoDate(date);
    const open = params.get("open");
    if (open) void openPanel(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fetchEvents = useCallback(async (info: { startStr: string; endStr: string }, ok: (e: EventInput[]) => void, fail: (e: Error) => void) => {
    const qs = new URLSearchParams({ start: info.startStr, end: info.endStr, status: filters.status.join(",") });
    if (filters.cleaner) qs.set("cleaner", filters.cleaner);
    if (filters.service) qs.set("service", filters.service);
    if (filters.area) qs.set("area", filters.area);
    if (filters.q.trim()) qs.set("q", filters.q.trim());
    try {
      const res = await fetch(`/api/admin/calendar?${qs}`, { cache: "no-store" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the calendar");
      ok(data.events);
    } catch (e) {
      fail(e as Error);
      toast({ kind: "error", text: "Couldn't load the calendar.", detail: (e as Error).message });
    }
  }, [filters, router, toast]);

  const eventSources = useMemo(() => [{ events: fetchEvents }], [fetchEvents]);
  const refetch = () => cal.current?.getApi().refetchEvents();

  async function openPanel(id: string) {
    setPanel({ id, detail: null });
    const r = await appointmentPanelAction(id);
    if (r.ok) setPanel({ id, detail: r.data as AppointmentDetail });
    else { setPanel(null); toast({ kind: "error", text: r.error ?? "Couldn't open that appointment." }); }
  }

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    const kind = arg.event.extendedProps.kind;
    if (kind === "appointment") void openPanel(arg.event.id);
    else if (kind === "block") setBlockToDelete({ id: arg.event.extendedProps.blockId, title: arg.event.title });
  }

  function onSelect(arg: DateSelectArg) {
    cal.current?.getApi().unselect();
    if (blockMode) {
      const end = arg.allDay ? DateTime.fromJSDate(arg.end).setZone(tz).startOf("day").toJSDate() : arg.end;
      setBlock({ start: arg.start, end, reason: "" });
      return;
    }
    const minutes = arg.allDay ? null : Math.round((arg.end.getTime() - arg.start.getTime()) / 60000);
    const start = arg.allDay ? DateTime.fromJSDate(arg.start).setZone(tz).set({ hour: 9 }).toISO() : DateTime.fromJSDate(arg.start).toISO();
    setCreate({ start, minutes: minutes && minutes >= 60 ? minutes : null });
  }

  function onMove(arg: EventDropArg | EventResizeDoneArg) {
    const e = arg.event;
    if (!e.start || !e.end) return arg.revert();
    const oldStart = "oldEvent" in arg ? arg.oldEvent.start! : e.start;
    setNotifyMove(true);
    setMove({ id: e.id, title: e.title, start: e.start, end: e.end, oldStart, revert: arg.revert });
  }

  async function saveMove(force: boolean) {
    if (!move) return;
    setSaving(true);
    const minutes = Math.round((move.end.getTime() - move.start.getTime()) / 60000);
    const r = await rescheduleAction(move.id, move.start.toISOString(), minutes, force, notifyMove);
    setSaving(false);
    if (r.ok) {
      const email = r.email ? (r.email.status === "sent" ? "Customer emailed." : r.email.status === "skipped" ? `No email sent: ${r.email.error}.` : `Email failed: ${r.email.error}.`) : undefined;
      toast({ kind: "success", text: r.message ?? "Moved.", detail: email });
      setMove(null);
      refetch();
      router.refresh();
    } else if (r.conflicts?.length && !force) {
      setMove({ ...move, conflicts: r.conflicts });
    } else {
      toast({ kind: "error", text: r.error ?? "Couldn't move it." });
      move.revert();
      setMove(null);
    }
  }

  function cancelMove() {
    move?.revert();
    setMove(null);
  }

  async function saveBlock() {
    if (!block) return;
    setSaving(true);
    const r = await createBlockAction(block.start.toISOString(), block.end.toISOString(), block.reason);
    setSaving(false);
    if (r.ok) { toast({ kind: "success", text: r.message ?? "Blocked." }); setBlock(null); setBlockMode(false); refetch(); }
    else toast({ kind: "error", text: r.error ?? "Couldn't block that time." });
  }

  async function removeBlock() {
    if (!blockToDelete) return;
    const r = await deleteBlockAction(blockToDelete.id);
    toast({ kind: r.ok ? "success" : "error", text: r.ok ? r.message ?? "Removed." : r.error ?? "Couldn't remove it." });
    setBlockToDelete(null);
    refetch();
  }

  function changeView(v: View) {
    setView(v);
    cal.current?.getApi().changeView(v);
  }

  const renderEvent = (arg: EventContentArg) => {
    const p = arg.event.extendedProps as { kind: string; customer?: string; service?: string; cleaners?: string[]; attention?: string | null; recurring?: boolean };
    if (p.kind !== "appointment") return <div className="truncate px-1 text-xs font-semibold">{arg.event.title}</div>;
    const compact = arg.view.type === "dayGridMonth";
    return (
      <div className="min-w-0 overflow-hidden px-1 py-0.5 text-xs leading-tight text-charcoal">
        <div className="flex items-center gap-1 font-semibold">
          {p.attention && <span className="inline-block size-2 shrink-0 rounded-full bg-status-pending" title={p.attention} aria-label="Needs attention" />}
          {p.recurring && <Repeat className="size-3 shrink-0" aria-label="Recurring" />}
          {compact && <span className="shrink-0">{arg.timeText}</span>}
          <span className="truncate">{p.customer}</span>
        </div>
        {!compact && <div className="truncate">{arg.timeText} · {p.service}</div>}
        {!compact && <div className="truncate text-[11px] opacity-80">{p.cleaners?.length ? p.cleaners.join(", ") : "Unassigned"}</div>}
      </div>
    );
  };

  const activeFilters = [filters.cleaner, filters.service, filters.area].filter(Boolean).length + (filters.status.length !== 3 ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-outline size-11 p-0" onClick={() => cal.current?.getApi().prev()} aria-label="Previous"><ChevronLeft className="size-5" aria-hidden /></button>
          <button type="button" className="btn btn-outline size-11 p-0" onClick={() => cal.current?.getApi().next()} aria-label="Next"><ChevronRight className="size-5" aria-hidden /></button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => cal.current?.getApi().today()}>Today</button>
          <h2 className="ml-2 text-xl font-semibold sm:text-2xl" aria-live="polite">{title}</h2>
          {loading && <Loader2 className="size-4 animate-spin text-muted" aria-label="Loading" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-white p-1" role="group" aria-label="Calendar view">
            {VIEWS.map((x) => (
              <button key={x.v} type="button" aria-pressed={view === x.v} onClick={() => changeView(x.v)} className={`min-h-9 rounded-[calc(var(--radius-control)-4px)] px-3 text-sm font-semibold ${view === x.v ? "bg-obsidian text-champagne" : "text-charcoal hover:bg-cream"}`}>{x.l}</button>
            ))}
          </div>
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal className="size-4" aria-hidden />Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
          <button type="button" className={`btn btn-sm ${blockMode ? "btn-dark" : "btn-outline"}`} aria-pressed={blockMode} onClick={() => setBlockMode((b) => !b)}><Ban className="size-4" aria-hidden />{blockMode ? "Select time to block" : "Block time"}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreate({ start: null, minutes: null })}><CalendarPlus className="size-4" aria-hidden />New</button>
        </div>
      </div>

      {showFilters && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-1"><span className="field-label">Search</span>
            <span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input className="input pl-9" placeholder="Name, phone, ref" defaultValue={filters.q} onKeyDown={(e) => { if (e.key === "Enter") setFilters({ ...filters, q: e.currentTarget.value }); }} onBlur={(e) => setFilters({ ...filters, q: e.currentTarget.value })} />
            </span>
          </label>
          <label><span className="field-label">Cleaner</span>
            <select className="input" value={filters.cleaner} onChange={(e) => setFilters({ ...filters, cleaner: e.target.value })}><option value="">All cleaners</option>{cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select>
          </label>
          <label><span className="field-label">Service</span>
            <select className="input" value={filters.service} onChange={(e) => setFilters({ ...filters, service: e.target.value })}><option value="">All services</option>{services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
          </label>
          <label><span className="field-label">Area</span>
            <select className="input" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })}><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <fieldset><legend className="field-label">Status</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {STATUSES.map((s) => (
                <label key={s.v} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={filters.status.includes(s.v)} onChange={(e) => setFilters({ ...filters, status: e.target.checked ? [...filters.status, s.v] : filters.status.filter((x) => x !== s.v) })} />{s.l}</label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {blockMode && <p className="rounded-[var(--radius-control)] bg-obsidian px-4 py-3 text-sm text-champagne" role="status">Drag across the calendar (or tap a day in month view) to block that time from online booking.</p>}

      <div className="card overflow-hidden p-2 sm:p-4">
        <FullCalendar
          ref={cal}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          timeZone={tz}
          initialView="timeGridWeek"
          headerToolbar={false}
          height="auto"
          expandRows
          nowIndicator
          selectable
          selectMirror
          editable
          eventDurationEditable
          eventStartEditable
          longPressDelay={350}
          eventLongPressDelay={350}
          selectLongPressDelay={350}
          slotMinTime="06:00:00"
          slotMaxTime="21:00:00"
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          scrollTime="07:30:00"
          allDaySlot={false}
          dayMaxEvents={4}
          businessHours={businessHours}
          eventSources={eventSources}
          eventContent={renderEvent}
          eventClick={onEventClick}
          select={onSelect}
          eventDrop={onMove}
          eventResize={onMove}
          loading={setLoading}
          datesSet={(arg) => setTitle(arg.view.title)}
          noEventsContent="Nothing scheduled in this range."
          firstDay={0}
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        />
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label="Legend">
        {[["pending", "Pending (dashed)"], ["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled / declined"], ["blocked", "Blocked / time off"]].map(([k, l]) => (
          <li key={k} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-5 rounded-sm border-l-4 legend-${k}`} aria-hidden />{l}</li>
        ))}
        <li className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-status-pending" aria-hidden />Needs attention</li>
        <li className="inline-flex items-center gap-1.5"><Repeat className="size-3" aria-hidden />Recurring</li>
      </ul>

      <Dialog open={Boolean(panel)} onClose={() => setPanel(null)} title="Appointment" side>
        {panel?.detail ? (
          <>
            <AppointmentPanel detail={panel.detail} cleaners={cleaners} tz={tz} canMoney={canMoney} defaultChecklist={defaultChecklist} onChanged={() => { refetch(); void openPanel(panel.id); }} />
            <a href={`/admin/appointments/${panel.id}`} className="mt-6 inline-block text-sm font-semibold text-gold-ink">Open full page →</a>
          </>
        ) : <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden />Loading…</p>}
      </Dialog>

      <NewAppointmentDialog open={Boolean(create)} onClose={() => setCreate(null)} tz={tz} services={services} cleaners={cleaners} initialStart={create?.start} initialMinutes={create?.minutes} onCreated={refetch} />

      <Dialog open={Boolean(move)} onClose={cancelMove} title={move?.conflicts ? "This time has conflicts" : "Move appointment?"}>
        {move && (
          <div className="space-y-4 text-sm">
            <p><strong>{move.title}</strong></p>
            <p>From {DateTime.fromJSDate(move.oldStart).setZone(tz).toFormat("ccc, LLL d · h:mm a")}<br />To <strong>{DateTime.fromJSDate(move.start).setZone(tz).toFormat("ccc, LLL d · h:mm a")} – {DateTime.fromJSDate(move.end).setZone(tz).toFormat("h:mm a")}</strong></p>
            {move.conflicts && (
              <ul className="list-disc space-y-1 rounded-[var(--radius-control)] bg-status-pending-bg py-3 pl-8 pr-3 text-status-pending">{move.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={notifyMove} onChange={(e) => setNotifyMove(e.target.checked)} />Email the customer about the new time</label>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={`btn ${move.conflicts ? "btn-danger" : "btn-primary"}`} disabled={saving} onClick={() => saveMove(Boolean(move.conflicts))}>{saving ? "Saving…" : move.conflicts ? "Move anyway" : "Move"}</button>
              <button type="button" className="btn btn-ghost" onClick={cancelMove}>Put it back</button>
            </div>
            {move.conflicts && <p className="text-xs text-muted">A cleaner can never be double-booked. If a cleaner overlaps, unassign them first.</p>}
          </div>
        )}
      </Dialog>

      <Dialog open={Boolean(block)} onClose={() => setBlock(null)} title="Block time">
        {block && (
          <div className="space-y-4 text-sm">
            <p>{DateTime.fromJSDate(block.start).setZone(tz).toFormat("ccc, LLL d · h:mm a")} – {DateTime.fromJSDate(block.end).setZone(tz).toFormat("ccc, LLL d · h:mm a")}</p>
            <label className="block"><span className="field-label">Reason (staff only)</span><input className="input" maxLength={200} value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} placeholder="Holiday, training, personal…" /></label>
            <p className="text-xs text-muted">Customers won&apos;t be offered times in this window. Existing appointments aren&apos;t changed.</p>
            <div className="flex gap-3"><button type="button" className="btn btn-dark" disabled={saving} onClick={saveBlock}>Block this time</button><button type="button" className="btn btn-ghost" onClick={() => setBlock(null)}>Cancel</button></div>
          </div>
        )}
      </Dialog>

      <Dialog open={Boolean(blockToDelete)} onClose={() => setBlockToDelete(null)} title="Blocked time">
        {blockToDelete && (
          <div className="space-y-4 text-sm"><p>{blockToDelete.title}</p>
            <div className="flex gap-3"><button type="button" className="btn btn-danger" onClick={removeBlock}>Remove block</button><button type="button" className="btn btn-ghost" onClick={() => setBlockToDelete(null)}>Keep</button></div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
