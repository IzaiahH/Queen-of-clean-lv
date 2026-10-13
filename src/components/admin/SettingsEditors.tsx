"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createStaffAction, resetPasswordAction, updateStaffAction } from "@/app/admin/actions/cleaners";
import { deleteTestimonialAction, saveSettingAction, saveTestimonialAction, sendTestEmailAction } from "@/app/admin/actions/settings";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAction } from "@/components/ui/useAction";
import { retryEmailAction } from "@/app/admin/actions/appointments";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import type { Settings, SettingsKey } from "@/lib/settings/schema";

function useSave<K extends SettingsKey>(key: K) {
  const { run, pending } = useAction();
  return { save: (v: Settings[K]) => run(() => saveSettingAction(key, v)), pending };
}
const SaveBar = ({ pending, onSave }: { pending: boolean; onSave: () => void }) => (
  <div className="sticky bottom-0 -mx-4 mt-5 border-t border-line bg-ivory/95 px-4 py-3 backdrop-blur"><button type="button" className="btn btn-primary" disabled={pending} onClick={onSave}>{pending ? "Saving…" : "Save"}</button></div>
);
const Text = ({ label, value, onChange, max = 200, hint, type = "text" }: { label: string; value: string; onChange: (v: string) => void; max?: number; hint?: string; type?: string }) => (
  <label className="block"><span className="field-label">{label}</span><input className="input" type={type} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />{hint && <span className="field-hint">{hint}</span>}</label>
);
const Area = ({ label, value, onChange, max = 3000, rows = 4, hint }: { label: string; value: string; onChange: (v: string) => void; max?: number; rows?: number; hint?: string }) => (
  <label className="block"><span className="field-label">{label}</span><textarea className="input" rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />{hint && <span className="field-hint">{hint}</span>}</label>
);
const NumberField = ({ label, value, onChange, min = 0, max = 10000, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; hint?: string }) => (
  <label className="block"><span className="field-label">{label}</span><input className="input" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />{hint && <span className="field-hint">{hint}</span>}</label>
);
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);

export function BusinessSettings({ initial }: { initial: Settings["business"] }) {
  const [v, setV] = useState(initial);
  const { save, pending } = useSave("business");
  const [logoErr, setLogoErr] = useState("");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Business name" value={v.name} max={80} onChange={(x) => setV({ ...v, name: x })} />
        <Text label="Tagline" value={v.tagline} max={140} onChange={(x) => setV({ ...v, tagline: x })} />
        <Text label="Public phone" type="tel" value={v.phone} max={30} onChange={(x) => setV({ ...v, phone: x })} hint="Shown on the website. Leave blank to hide." />
        <Text label="Public email" type="email" value={v.email} max={120} onChange={(x) => setV({ ...v, email: x })} hint="Shown on the website and used as reply-to." />
        <Text label="Hours (as shown on the site)" value={v.hours_text} onChange={(x) => setV({ ...v, hours_text: x })} />
        <Text label="Response time message" value={v.response_time_text} onChange={(x) => setV({ ...v, response_time_text: x })} />
      </div>
      <Area label="About the business" value={v.description} max={1200} onChange={(x) => setV({ ...v, description: x })} hint="Only include facts you can stand behind. Don't list licenses, insurance or awards unless you have them." />
      <fieldset className="space-y-2"><legend className="field-label">Why choose us (homepage)</legend>
        {v.strengths.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-[1fr_2fr_auto]">
            <input aria-label="Title" className="input" maxLength={60} value={s.title} onChange={(e) => setV({ ...v, strengths: v.strengths.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <input aria-label="Text" className="input" maxLength={300} value={s.body} onChange={(e) => setV({ ...v, strengths: v.strengths.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            <button type="button" className="btn btn-ghost size-11 p-0" aria-label="Remove" onClick={() => setV({ ...v, strengths: v.strengths.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        {v.strengths.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setV({ ...v, strengths: [...v.strengths, { title: "", body: "" }] })}><Plus className="size-4" aria-hidden />Add</button>}
      </fieldset>
      <fieldset className="space-y-2"><legend className="field-label">Frequently asked questions</legend>
        {v.faqs.map((f, i) => (
          <div key={i} className="space-y-2 rounded-[var(--radius-control)] border border-line p-3">
            <div className="flex gap-2"><input aria-label="Question" className="input" maxLength={200} value={f.q} onChange={(e) => setV({ ...v, faqs: v.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
              <button type="button" className="btn btn-ghost size-11 shrink-0 p-0" aria-label="Remove" onClick={() => setV({ ...v, faqs: v.faqs.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></button></div>
            <textarea aria-label="Answer" className="input" rows={2} maxLength={1200} value={f.a} onChange={(e) => setV({ ...v, faqs: v.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
          </div>
        ))}
        {v.faqs.length < 20 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setV({ ...v, faqs: [...v.faqs, { q: "", a: "" }] })}><Plus className="size-4" aria-hidden />Add question</button>}
      </fieldset>
      <fieldset><legend className="field-label">Logo</legend>
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {v.logo_data_url ? <img src={v.logo_data_url} alt="Uploaded logo" className="h-14 rounded bg-obsidian p-2" /> : <span className="text-sm text-muted">Using the built-in crown wordmark.</span>}
          <label className="btn btn-outline btn-sm cursor-pointer">Upload PNG/JPG/WebP<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 280_000) { setLogoErr("Use an image under 280 KB."); return; }
            setLogoErr("");
            const r = new FileReader();
            r.onload = () => setV({ ...v, logo_data_url: String(r.result) });
            r.readAsDataURL(f);
          }} /></label>
          {v.logo_data_url && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setV({ ...v, logo_data_url: null })}>Use built-in logo</button>}
        </div>
        {logoErr && <p className="field-error">{logoErr}</p>}
        <p className="field-hint">Shows on a dark header, so a light or gold logo on a transparent background works best.</p>
      </fieldset>
      <SaveBar pending={pending} onSave={() => save({ ...v, strengths: v.strengths.filter((s) => s.title.trim()), faqs: v.faqs.filter((f) => f.q.trim() && f.a.trim()) })} />
    </div>
  );
}

const DAYS: [string, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["7", "Sunday"]];

export function BookingSettings({ initial }: { initial: Settings["booking"] }) {
  const [v, setV] = useState(initial);
  const [maxAuto, setMaxAuto] = useState(centsToInput(initial.auto_confirm.max_estimate_cents));
  const { save, pending } = useSave("booking");
  return (
    <div className="space-y-5">
      <fieldset><legend className="field-label">Business hours for bookings</legend>
        <ul className="divide-y divide-line">{DAYS.map(([k, label]) => {
          const h = v.operating_hours[k as "1"];
          return (
            <li key={k} className="flex flex-wrap items-center gap-3 py-2">
              <label className="flex w-32 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(h)} onChange={(e) => setV({ ...v, operating_hours: { ...v.operating_hours, [k]: e.target.checked ? { open: "08:00", close: "17:00" } : null } })} />{label}</label>
              {h ? <span className="flex items-center gap-2"><input aria-label={`${label} opens`} type="time" step={900} className="input !min-h-10 w-32" value={h.open} onChange={(e) => setV({ ...v, operating_hours: { ...v.operating_hours, [k]: { ...h, open: e.target.value } } })} />–<input aria-label={`${label} closes`} type="time" step={900} className="input !min-h-10 w-32" value={h.close} onChange={(e) => setV({ ...v, operating_hours: { ...v.operating_hours, [k]: { ...h, close: e.target.value } } })} /></span> : <span className="text-sm text-muted">Closed</span>}
            </li>
          );
        })}</ul>
        <p className="field-hint">Customers are offered times inside these hours when a cleaner is also working.</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField label="Time slot spacing (minutes)" value={v.slot_interval_minutes} min={15} max={240} onChange={(x) => setV({ ...v, slot_interval_minutes: x })} />
        <NumberField label="Minimum notice (hours)" value={v.lead_time_hours} max={720} onChange={(x) => setV({ ...v, lead_time_hours: x })} hint="How soon customers can book online" />
        <NumberField label="Book up to (days ahead)" value={v.horizon_days} min={7} max={180} onChange={(x) => setV({ ...v, horizon_days: x })} />
        <NumberField label="Travel buffer between jobs (minutes)" value={v.travel_buffer_minutes} max={180} onChange={(x) => setV({ ...v, travel_buffer_minutes: x })} />
        <NumberField label="Max jobs per day (whole business)" value={v.max_jobs_per_day} min={1} max={50} onChange={(x) => setV({ ...v, max_jobs_per_day: x })} />
        <NumberField label="Quotes valid for (days)" value={v.quote_expiration_days} min={1} max={180} onChange={(x) => setV({ ...v, quote_expiration_days: x })} />
        <Text label="Time zone" value={v.timezone} onChange={(x) => setV({ ...v, timezone: x })} hint="IANA name, e.g. America/Los_Angeles" />
      </div>
      <Check label="Accept requests from ZIP codes outside the service areas (flagged for review)" checked={v.allow_unknown_areas} onChange={(x) => setV({ ...v, allow_unknown_areas: x })} />
      <fieldset className="space-y-2 rounded-[var(--radius-control)] border border-line p-4"><legend className="px-1 text-sm font-semibold">Automatic confirmation</legend>
        <Check label="Confirm online bookings automatically when they qualify" checked={v.auto_confirm.enabled} onChange={(x) => setV({ ...v, auto_confirm: { ...v.auto_confirm, enabled: x } })} />
        {v.auto_confirm.enabled && <>
          <label className="block max-w-xs"><span className="field-label">Only when the estimate is at most</span><input className="input" inputMode="decimal" value={maxAuto} onChange={(e) => setMaxAuto(e.target.value)} /></label>
          <Check label="Only for returning customers" checked={v.auto_confirm.returning_customers_only} onChange={(x) => setV({ ...v, auto_confirm: { ...v.auto_confirm, returning_customers_only: x } })} />
        </>}
        <p className="field-hint">Requests that need review (large homes, heavy condition, outside areas, custom services) are never auto-confirmed. Off by default: every request starts as Pending Review.</p>
      </fieldset>
      <SaveBar pending={pending} onSave={() => save({ ...v, auto_confirm: { ...v.auto_confirm, max_estimate_cents: parseMoneyToCents(maxAuto) ?? 0 } })} />
    </div>
  );
}

export function PolicySettings({ initial }: { initial: Settings["policies"] }) {
  const [v, setV] = useState(initial);
  const { save, pending } = useSave("policies");
  return (
    <div className="space-y-4">
      {!v.policies_reviewed && <p className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-3 text-sm text-status-pending">These are starter drafts. Have them reviewed, edit as needed, then tick &quot;reviewed&quot; below. The website shows a &quot;draft&quot; note until you do.</p>}
      <NumberField label="Cancellation notice (hours)" value={v.cancellation_notice_hours} max={168} onChange={(x) => setV({ ...v, cancellation_notice_hours: x })} hint="Inside this window, customer cancellations from their link go to you for review instead of cancelling instantly." />
      <Area label="Cancellation policy" value={v.cancellation_policy} onChange={(x) => setV({ ...v, cancellation_policy: x })} />
      <Area label="Rescheduling policy" value={v.reschedule_policy} onChange={(x) => setV({ ...v, reschedule_policy: x })} />
      <Area label="Privacy policy" rows={10} max={20000} value={v.privacy_policy} onChange={(x) => setV({ ...v, privacy_policy: x })} />
      <Area label="Terms of service" rows={10} max={20000} value={v.terms_of_service} onChange={(x) => setV({ ...v, terms_of_service: x })} />
      <Check label="These policies have been reviewed and are ready to publish" checked={v.policies_reviewed} onChange={(x) => setV({ ...v, policies_reviewed: x })} />
      <SaveBar pending={pending} onSave={() => save(v)} />
    </div>
  );
}

export function NotificationSettings({ initial, emailReady, templates }: { initial: Settings["notifications"]; emailReady: boolean; templates: Settings["email_templates"] }) {
  const [v, setV] = useState(initial);
  const [emails, setEmails] = useState(initial.admin_emails.join(", "));
  const { save, pending } = useSave("notifications");
  const tpl = useSave("email_templates");
  const [t, setT] = useState(templates);
  const test = useAction();
  return (
    <div className="space-y-6">
      <p className={`rounded-[var(--radius-control)] border p-3 text-sm ${emailReady ? "border-status-completed/40 bg-status-completed-bg text-status-completed" : "border-status-pending/40 bg-status-pending-bg text-status-pending"}`}>
        {emailReady ? "Email provider connected (Resend). Every email is logged with its real delivery status." : "Email isn't connected yet. Emails are logged as \"Not sent\" until RESEND_API_KEY and EMAIL_FROM are set on the server. Nothing claims an email was sent when it wasn't."}
      </p>
      <div className="space-y-3">
        <Text label="Send new-request alerts to" value={emails} onChange={setEmails} max={600} hint="Up to 5 addresses, separated by commas." />
        <Check label="Email customers about their requests and appointments" checked={v.customer_emails_enabled} onChange={(x) => setV({ ...v, customer_emails_enabled: x })} />
        <Check label="Email the team when a new request comes in" checked={v.admin_new_request_enabled} onChange={(x) => setV({ ...v, admin_new_request_enabled: x })} />
        <NumberField label="Reminder email (hours before, 0 = off)" value={v.reminder_hours_before} max={168} onChange={(x) => setV({ ...v, reminder_hours_before: x })} />
        <Check label="Send a thank-you follow-up after completed jobs" checked={v.followup_enabled} onChange={(x) => setV({ ...v, followup_enabled: x })} />
        <p className="text-xs text-muted">Text messages (SMS) aren&apos;t connected in this version.</p>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save({ ...v, admin_emails: emails.split(/[,\s]+/).filter(Boolean), sms_enabled: false })}>Save notifications</button>
      </div>
      <div className="space-y-4 border-t border-line pt-5">
        <h3 className="text-xl font-semibold">Email wording</h3>
        <p className="text-xs text-muted">Use placeholders like {"{{first_name}}"}, {"{{service}}"}, {"{{date_time}}"}, {"{{estimate}}"}, {"{{manage_url}}"}, {"{{quote_url}}"}, {"{{business_name}}"}. Never put access codes in subjects.</p>
        {Object.entries(t).map(([k, x]) => (
          <details key={k} className="rounded-[var(--radius-control)] border border-line bg-white p-3">
            <summary className="cursor-pointer font-semibold">{k.replace(/_/g, " ")}</summary>
            <div className="mt-3 space-y-2">
              <Text label="Subject" value={x.subject} onChange={(s) => setT({ ...t, [k]: { ...x, subject: s } })} />
              <Area label="Body" rows={7} max={5000} value={x.body} onChange={(b) => setT({ ...t, [k]: { ...x, body: b } })} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={test.pending || !emailReady} onClick={() => test.run(() => sendTestEmailAction(k))}>Send me a test</button>
            </div>
          </details>
        ))}
        <button type="button" className="btn btn-primary" disabled={tpl.pending} onClick={() => tpl.save(t)}>Save email wording</button>
      </div>
    </div>
  );
}

export function OperationsSettings({ recurring, privacy }: { recurring: Settings["recurring"]; privacy: Settings["privacy"] }) {
  const [r, setR] = useState(recurring);
  const [list, setList] = useState(recurring.default_checklist.join("\n"));
  const [p, setP] = useState(privacy);
  const rs = useSave("recurring");
  const ps = useSave("privacy");
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <NumberField label="Create recurring visits this many weeks ahead" value={r.horizon_weeks} min={2} max={26} onChange={(x) => setR({ ...r, horizon_weeks: x })} hint="Visits are added daily; existing visits are never duplicated." />
        <Area label="Default job checklist (one item per line)" rows={9} value={list} onChange={setList} />
        <button type="button" className="btn btn-primary" disabled={rs.pending} onClick={() => rs.save({ ...r, default_checklist: list.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 60) })}>Save</button>
      </div>
      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-xl font-semibold">Data retention</h3>
        <NumberField label="Keep customer records (years)" value={p.retention_years} min={1} max={20} onChange={(x) => setP({ ...p, retention_years: x })} hint="Used as guidance in your privacy policy. Records aren't deleted automatically." />
        <NumberField label="Delete handled website messages after (days)" value={p.contact_message_retention_days} min={30} max={3650} onChange={(x) => setP({ ...p, contact_message_retention_days: x })} hint="Applied by the daily maintenance job." />
        <button type="button" className="btn btn-primary" disabled={ps.pending} onClick={() => ps.save(p)}>Save</button>
      </div>
    </div>
  );
}

type T = { id: string; author_name: string; body: string; context: string; permission_confirmed: boolean; published: boolean; sort: number };
export function TestimonialsEditor({ items }: { items: T[] }) {
  const [edit, setEdit] = useState<T | null>(null);
  const { run, pending } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Add only real reviews from real customers, with their permission. Nothing appears on the website unless you confirm permission and choose to publish it.</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit({ id: "", author_name: "", body: "", context: "", permission_confirmed: false, published: false, sort: 0 })}>Add testimonial</button>
      <ul className="space-y-2">{items.map((x) => (
        <li key={x.id} className="rounded-[var(--radius-control)] border border-line bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{x.author_name}</span><StatusBadge status={x.published ? "active" : "inactive"} label={x.published ? "On website" : "Hidden"} /></div>
          <p className="mt-1 text-muted">“{x.body}”</p>
          <div className="mt-2 flex gap-1"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(x)}>Edit</button>
            <ConfirmButton label="Delete" title="Delete testimonial?" body="This can't be undone." confirmLabel="Delete" danger className="btn btn-ghost btn-sm text-danger" disabled={pending} onConfirm={() => run(() => deleteTestimonialAction(x.id))} /></div>
        </li>
      ))}</ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.id ? "Edit testimonial" : "Add testimonial"}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => saveTestimonialAction(edit.id || null, edit), { onSuccess: () => setEdit(null) }); }}>
            <Text label="Name as it should appear" value={edit.author_name} max={80} onChange={(x) => setEdit({ ...edit, author_name: x })} hint='e.g. "Maria G."' />
            <Area label="What they said" value={edit.body} max={1500} onChange={(x) => setEdit({ ...edit, body: x })} />
            <Text label="Context (optional)" value={edit.context} max={120} onChange={(x) => setEdit({ ...edit, context: x })} hint='e.g. "Biweekly client, Summerlin"' />
            <Check label="I have this customer's permission to publish their words and name" checked={edit.permission_confirmed} onChange={(x) => setEdit({ ...edit, permission_confirmed: x, published: x && edit.published })} />
            <Check label="Show on the website" checked={edit.published} onChange={(x) => setEdit({ ...edit, published: x && edit.permission_confirmed })} />
            <div className="flex gap-3"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

type Staff = { id: string; email: string; full_name: string; role: string; active: boolean; cleaner_id: string | null; cleaner_name: string | null; last_sign_in_at: Date | string | null };
const ROLE_TEXT: Record<string, string> = { owner: "Owner (everything)", admin: "Administrator (everything except logins)", office: "Office (schedule, customers, quotes; no money)", cleaner: "Cleaner (only their own jobs)" };

export function TeamEditor({ staff, cleaners, currentUserId, provider }: { staff: Staff[]; cleaners: { id: string; full_name: string }[]; currentUserId: string; provider: string }) {
  const [form, setForm] = useState<{ id: string | null; email: string; full_name: string; role: "owner" | "admin" | "office" | "cleaner"; cleaner_id: string | null; active: boolean; password: string } | null>(null);
  const [pw, setPw] = useState<{ id: string; name: string; password: string } | null>(null);
  const { run, pending } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Each person signs in with their own account. Sign-in uses {provider === "supabase" ? "Supabase Auth" : "this app's secure local accounts"}. Give temporary passwords privately; never by email subject or text preview.</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm({ id: null, email: "", full_name: "", role: "office", cleaner_id: null, active: true, password: "" })}>Add login</button>
      <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {staff.map((s) => (
          <tr key={s.id}><td className="font-semibold">{s.full_name}<span className="block text-xs font-normal text-muted">{s.email}{s.cleaner_name ? ` · ${s.cleaner_name}` : ""}</span></td><td className="text-sm">{ROLE_TEXT[s.role]?.split(" (")[0] ?? s.role}</td><td><StatusBadge status={s.active ? "active" : "inactive"} label={s.active ? "Active" : "Disabled"} /></td>
            <td className="whitespace-nowrap"><button type="button" className="btn btn-ghost btn-sm" disabled={s.id === currentUserId} onClick={() => setForm({ id: s.id, email: s.email, full_name: s.full_name, role: s.role as "office", cleaner_id: s.cleaner_id, active: s.active, password: "" })}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPw({ id: s.id, name: s.full_name, password: "" })}>Reset password</button></td></tr>
        ))}
      </tbody></table></div>
      {form && (
        <Dialog open onClose={() => setForm(null)} title={form.id ? "Edit login" : "Add login"}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            run(() => (form.id ? updateStaffAction(form.id, { role: form.role, active: form.active, cleaner_id: form.cleaner_id, full_name: form.full_name }) : createStaffAction({ email: form.email, full_name: form.full_name, role: form.role, cleaner_id: form.cleaner_id, password: form.password })), { onSuccess: () => setForm(null) });
          }}>
            <Text label="Name" value={form.full_name} max={120} onChange={(x) => setForm({ ...form, full_name: x })} />
            {!form.id && <Text label="Email" type="email" value={form.email} max={200} onChange={(x) => setForm({ ...form, email: x })} />}
            <label className="block"><span className="field-label">Role</span><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "office" })}>{Object.entries(ROLE_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {form.role === "cleaner" && <label className="block"><span className="field-label">Cleaner profile</span><select className="input" value={form.cleaner_id ?? ""} onChange={(e) => setForm({ ...form, cleaner_id: e.target.value || null })}><option value="">Choose…</option>{cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>}
            {!form.id && <Text label="Temporary password (12+ characters)" type="password" value={form.password} max={200} onChange={(x) => setForm({ ...form, password: x })} />}
            {form.id && <Check label="Active (can sign in)" checked={form.active} onChange={(x) => setForm({ ...form, active: x })} />}
            <div className="flex gap-3"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button></div>
          </form>
        </Dialog>
      )}
      {pw && (
        <Dialog open onClose={() => setPw(null)} title={`New password for ${pw.name}`}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => resetPasswordAction(pw.id, pw.password), { onSuccess: () => setPw(null) }); }}>
            <Text label="New password (12+ characters)" type="password" value={pw.password} max={200} onChange={(x) => setPw({ ...pw, password: x })} />
            <p className="text-xs text-muted">They&apos;ll be signed out on all devices.</p>
            <div className="flex gap-3"><button className="btn btn-primary" disabled={pending}>Set password</button><button type="button" className="btn btn-ghost" onClick={() => setPw(null)}>Cancel</button></div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

export function RetryEmailButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => retryEmailAction(id))}>{pending ? "Retrying…" : "Retry"}</button>;
}
