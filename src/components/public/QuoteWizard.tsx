"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { formatCents } from "@/lib/money";
import { CONDITION_LABELS, FREQUENCY_LABELS, type Condition, type Frequency } from "@/lib/pricing/rules";
import { minutesLabel } from "@/lib/time";

export type WizardCatalog = {
  services: { slug: string; name: string; short: string; frequencies: Frequency[]; kind: string }[];
  addons: {
    slug: string;
    name: string;
    description: string;
    price_cents: number;
    unit: "flat" | "each";
    unit_label: string;
    max_quantity: number;
    applies_to: string[];
    starting_at: boolean;
  }[];
  policies: { cancellation: string; reschedule: string };
  responseTime: string;
  businessName: string;
};

type Estimate = {
  mode: "estimate" | "custom";
  lines: { label: string; amount_cents: number; kind: string }[];
  total_cents: number;
  recurring_per_visit_cents: number | null;
  estimated_minutes: number;
  requires_review: boolean;
  review_reasons: string[];
  notes: string[];
  area_name: string | null;
  area_message: string | null;
};

type Slot = { start: string; label: string };
type Day = { date: string; label: string; slots: Slot[] };

type State = {
  service: string;
  frequency: Frequency | "";
  property_type: "house" | "townhome" | "condo" | "apartment" | "other";
  bedrooms: number;
  full_baths: number;
  half_baths: number;
  sqft: string;
  sqft_unknown: boolean;
  condition: Condition | "not_sure" | "";
  recently_cleaned: "yes" | "no" | "not_sure" | "";
  pets: number;
  pet_details: string;
  occupancy: string;
  special_requests: string;
  address_line1: string;
  unit: string;
  city: string;
  zip: string;
  addons: Record<string, number>;
  preferred_window: "morning" | "afternoon" | "flexible";
  wants_recurring: boolean;
  slot: Slot | null;
  slot_day: string;
  preferences: string;
  full_name: string;
  email: string;
  phone: string;
  preferred_contact: "email" | "phone" | "text";
  access_instructions: string;
  notes: string;
  consent: boolean;
  mode: "book" | "quote_only";
};

const STEPS = ["Service", "Your home", "Frequency & extras", "Estimate", "Appointment", "Your details", "Review"] as const;
const STORAGE_KEY = "qoc-quote-wizard-v1";

const initial = (service: string | null): State => ({
  service: service ?? "",
  frequency: "",
  property_type: "house",
  bedrooms: 2,
  full_baths: 2,
  half_baths: 0,
  sqft: "",
  sqft_unknown: false,
  condition: "",
  recently_cleaned: "",
  pets: 0,
  pet_details: "",
  occupancy: "",
  special_requests: "",
  address_line1: "",
  unit: "",
  city: "Las Vegas",
  zip: "",
  addons: {},
  preferred_window: "flexible",
  wants_recurring: false,
  slot: null,
  slot_day: "",
  preferences: "",
  full_name: "",
  email: "",
  phone: "",
  preferred_contact: "email",
  access_instructions: "",
  notes: "",
  consent: false,
  mode: "book",
});

type Result = { kind: "appointment" | "quote"; reference: string; status: string; manage_url: string | null; quote_url: string | null; email: string | null };

export function QuoteWizard({ catalog, initialService }: { catalog: WizardCatalog; initialService: string | null }) {
  const validInitial = catalog.services.some((s) => s.slug === initialService) ? initialService : null;
  const [s, setS] = useState<State>(() => initial(validInitial));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateState, setEstimateState] = useState<"idle" | "loading" | "error">("idle");
  const [estimateError, setEstimateError] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [daysFrom, setDaysFrom] = useState<string | null>(null);
  const [availState, setAvailState] = useState<"idle" | "loading" | "error">("idle");
  const [availError, setAvailError] = useState("");
  const [horizonEnd, setHorizonEnd] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [restored, setRestored] = useState(false);
  const idemKey = useRef<string>("");
  const startedAt = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore answers after a reload (session only — nothing stored after submission).
  // sessionStorage only exists in the browser, so this has to run after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { s: State; step: number; key: string; startedAt: number };
        setS({ ...initial(null), ...saved.s, slot: null, ...(validInitial && !saved.s.service ? { service: validInitial } : {}) });
        setStep(Math.min(saved.step, 2));
        idemKey.current = saved.key;
        startedAt.current = saved.startedAt;
      }
    } catch {
      /* ignore */
    }
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    if (!startedAt.current) startedAt.current = Date.now();
    setRestored(true);
  }, [validInitial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!restored || result) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ s, step, key: idemKey.current, startedAt: startedAt.current }));
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }, [s, step, restored, result]);

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));
  const service = catalog.services.find((x) => x.slug === s.service) ?? null;
  const addons = useMemo(() => catalog.addons.filter((a) => a.applies_to.includes("*") || a.applies_to.includes(s.service)), [catalog.addons, s.service]);

  const propertyPayload = useCallback(
    () => ({
      service: s.service,
      frequency: (s.frequency || "one_time") as Frequency,
      property_type: s.property_type,
      bedrooms: s.bedrooms,
      full_baths: s.full_baths,
      half_baths: s.half_baths,
      sqft: s.sqft_unknown || s.sqft === "" ? null : Number(s.sqft),
      condition: s.condition === "not_sure" || s.condition === "" ? null : s.condition,
      pets: s.pets,
      addons: Object.entries(s.addons)
        .filter(([slug, q]) => q > 0 && addons.some((a) => a.slug === slug))
        .map(([slug, quantity]) => ({ slug, quantity })),
      zip: s.zip.trim(),
    }),
    [s, addons],
  );

  function validate(i: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (i === 0 && !service) e.service = "Choose a service to continue";
    if (i === 1) {
      if (!s.sqft_unknown && s.sqft !== "" && (!/^\d+$/.test(s.sqft) || Number(s.sqft) < 100 || Number(s.sqft) > 50000)) e.sqft = "Enter a number between 100 and 50,000, or choose “Not sure”";
      if (!s.sqft_unknown && s.sqft === "") e.sqft = "Enter the approximate square footage, or choose “Not sure”";
      if (s.address_line1.trim().length < 3) e.address_line1 = "Enter the street address";
      if (s.city.trim().length < 2) e.city = "Enter the city";
      if (!/^\d{5}$/.test(s.zip.trim())) e.zip = "Enter a 5-digit ZIP code";
      if (!s.condition) e.condition = "Choose the option that fits best (or “Not sure”)";
      if (!s.recently_cleaned) e.recently_cleaned = "Choose one";
    }
    if (i === 2 && !s.frequency) e.frequency = "Choose how often";
    if (i === 4 && s.mode === "book" && !s.slot) e.slot = "Choose an available time";
    if (i === 5) {
      if (s.full_name.trim().length < 2) e.full_name = "Enter your full name";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) e.email = "Enter a valid email address";
      const d = s.phone.replace(/\D/g, "");
      if (!(d.length === 10 || (d.length === 11 && d.startsWith("1")))) e.phone = "Enter a 10-digit phone number";
      if (!s.consent) e.consent = "Please agree so we can contact you about this request";
    }
    return e;
  }

  function goTo(i: number) {
    setStep(i);
    setErrors({});
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true'], [data-error='true']")?.focus());
      return;
    }
    if (step === 2) {
      goTo(3);
      void fetchEstimate();
      return;
    }
    if (step === 3) {
      if (!estimate) return;
      if (s.mode === "quote_only") return goTo(5);
      goTo(4);
      if (days.length === 0) void fetchDays(null);
      return;
    }
    goTo(Math.min(step + 1, STEPS.length - 1));
  }

  function back() {
    if (step === 5 && s.mode === "quote_only") return goTo(3);
    goTo(Math.max(0, step - 1));
  }

  async function fetchEstimate() {
    setEstimateState("loading");
    setEstimate(null);
    try {
      const res = await fetch("/api/quote/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(propertyPayload()) });
      const data = await res.json();
      if (!res.ok) {
        setEstimateError(data.error ?? "We couldn't calculate an estimate.");
        setEstimateState("error");
        return;
      }
      setEstimate(data.estimate);
      setEstimateState("idle");
      // Prices or duration changed → any previously chosen time must be re-picked.
      setDays([]);
      setS((p) => ({ ...p, slot: null }));
    } catch {
      setEstimateError("We couldn't reach the server. Check your connection and try again.");
      setEstimateState("error");
    }
  }

  async function fetchDays(from: string | null) {
    setAvailState("loading");
    try {
      const res = await fetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ property: propertyPayload(), from: from ?? undefined, days: 7 }) });
      const data = await res.json();
      if (!res.ok) {
        setAvailError(data.error ?? "We couldn't load availability.");
        setAvailState("error");
        return;
      }
      setDays(data.days);
      setDaysFrom(from);
      setHorizonEnd(data.horizon_end);
      const firstOpen = (data.days as Day[]).find((d) => d.slots.length > 0);
      setS((p) => ({ ...p, slot_day: firstOpen?.date ?? data.days[0]?.date ?? "" }));
      setAvailState("idle");
    } catch {
      setAvailError("We couldn't reach the server. Check your connection and try again.");
      setAvailState("error");
    }
  }

  async function submit() {
    if (submitState === "sending") return; // prevents double submits; the idempotency key protects retries too
    setSubmitState("sending");
    setSubmitError("");
    const payload = {
      idempotency_key: idemKey.current,
      mode: s.mode,
      property: {
        ...propertyPayload(),
        address_line1: s.address_line1,
        unit: s.unit,
        city: s.city,
        recently_cleaned: s.recently_cleaned || "not_sure",
        pet_details: s.pet_details,
        occupancy: s.occupancy,
        special_requests: s.special_requests,
      },
      schedule: { slot_start: s.mode === "book" ? s.slot?.start ?? null : null, preferred_window: s.preferred_window, preferences: s.preferences, wants_recurring: s.wants_recurring },
      contact: {
        full_name: s.full_name,
        email: s.email,
        phone: s.phone,
        preferred_contact: s.preferred_contact,
        access_instructions: s.access_instructions,
        notes: s.notes,
        consent: s.consent,
      },
      website: (document.getElementById("qoc-website") as HTMLInputElement | null)?.value ?? "",
      started_at: startedAt.current,
    };
    try {
      const res = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        setSubmitState("error");
        setSubmitError(data.error ?? "We couldn't submit your request.");
        if (data.slot_taken) {
          setS((p) => ({ ...p, slot: null }));
          setDays([]);
        }
        return;
      }
      setResult(data);
      setSubmitState("idle");
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => headingRef.current?.focus());
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // Network error: the request may or may not have arrived. Retrying reuses the same key, so it can't double-book.
      setSubmitState("error");
      setSubmitError("We couldn't confirm your request reached us. Please tap Submit again — you won't be booked twice.");
    }
  }

  if (result) return <Confirmation result={result} catalog={catalog} />;

  const shownStep = step;
  const visibleSteps: readonly string[] = s.mode === "quote_only" ? STEPS.filter((x) => x !== "Appointment") : STEPS;
  const stepIndexForBar = visibleSteps.indexOf(STEPS[shownStep]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 sm:px-6 sm:pb-16">
      {/* Progress */}
      <nav aria-label="Quote progress" className="-mt-6 rounded-[var(--radius-card)] border border-line bg-[#fffdf8] p-4 shadow-[var(--shadow-soft)]">
        <p className="text-sm font-semibold">
          Step {stepIndexForBar + 1} of {visibleSteps.length} <span className="text-muted">· {STEPS[shownStep]}</span>
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream" role="progressbar" aria-valuemin={1} aria-valuemax={visibleSteps.length} aria-valuenow={stepIndexForBar + 1}>
          <div className="h-full rounded-full bg-gradient-to-r from-champagne to-gold transition-all" style={{ width: `${((stepIndexForBar + 1) / visibleSteps.length) * 100}%` }} />
        </div>
        <ol className="mt-3 hidden gap-1 text-xs sm:flex">
          {visibleSteps.map((label, i) => (
            <li key={label} className={`flex-1 truncate ${i <= stepIndexForBar ? "font-semibold text-gold-ink" : "text-muted"}`}>
              {i < stepIndexForBar ? <Check className="mr-0.5 inline size-3" aria-hidden /> : null}
              {label}
            </li>
          ))}
        </ol>
      </nav>

      <section className="mt-8" aria-live="polite">
        <h2 ref={headingRef} tabIndex={-1} className="scroll-mt-24 text-3xl font-semibold outline-none sm:text-4xl">
          {
            [
              "What can we help with?",
              "Tell us about your home",
              "How often, and any extras?",
              "Your estimate",
              "Choose an appointment time",
              "Your contact details",
              "Review and submit",
            ][step]
          }
        </h2>

        <div className="mt-6">
          {step === 0 && (
            <fieldset>
              <legend className="sr-only">Service</legend>
              <div className="grid gap-3" data-error={Boolean(errors.service)} tabIndex={errors.service ? -1 : undefined}>
                {catalog.services.map((x) => (
                  <label key={x.slug} className="choice">
                    <input type="radio" name="service" className="mt-1 accent-[var(--color-gold)]" checked={s.service === x.slug} onChange={() => setS((p) => ({ ...p, service: x.slug, frequency: x.frequencies.length === 1 ? x.frequencies[0] : x.frequencies.includes(p.frequency as Frequency) ? p.frequency : "" }))} />
                    <span>
                      <span className="block font-semibold">{x.name}</span>
                      <span className="block text-sm text-muted">{x.short}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.service && <p className="field-error" role="alert">{errors.service}</p>}
            </fieldset>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <Field label="Property type">
                {(p) => (
                  <select {...p} className="input" value={s.property_type} onChange={(e) => set("property_type", e.target.value as State["property_type"])}>
                    <option value="house">House</option>
                    <option value="townhome">Townhome</option>
                    <option value="condo">Condo</option>
                    <option value="apartment">Apartment</option>
                    <option value="other">Other</option>
                  </select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stepper label="Bedrooms" value={s.bedrooms} min={0} max={20} onChange={(v) => set("bedrooms", v)} />
                <Stepper label="Full bathrooms" value={s.full_baths} min={0} max={20} onChange={(v) => set("full_baths", v)} />
                <Stepper label="Half bathrooms" value={s.half_baths} min={0} max={20} onChange={(v) => set("half_baths", v)} hint="Toilet + sink only" />
              </div>
              <div>
                <Field label="Approximate square footage" error={errors.sqft} hint="A rough number is fine.">
                  {(p) => (
                    <input {...p} className="input" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1800" disabled={s.sqft_unknown} value={s.sqft} onChange={(e) => set("sqft", e.target.value.replace(/[^\d]/g, ""))} />
                  )}
                </Field>
                <label className="mt-2 inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--color-gold)]" checked={s.sqft_unknown} onChange={(e) => setS((p) => ({ ...p, sqft_unknown: e.target.checked, sqft: e.target.checked ? "" : p.sqft }))} />
                  Not sure — estimate it from my bedrooms
                </label>
              </div>
              <fieldset data-error={Boolean(errors.condition)} tabIndex={errors.condition ? -1 : undefined}>
                <legend className="field-label">General condition of the home</legend>
                <div className="grid gap-2">
                  {(Object.keys(CONDITION_LABELS) as Condition[]).map((c) => (
                    <label key={c} className="choice py-3">
                      <input type="radio" name="condition" className="mt-1 accent-[var(--color-gold)]" checked={s.condition === c} onChange={() => set("condition", c)} />
                      <span className="text-sm">{CONDITION_LABELS[c]}</span>
                    </label>
                  ))}
                  <label className="choice py-3">
                    <input type="radio" name="condition" className="mt-1 accent-[var(--color-gold)]" checked={s.condition === "not_sure"} onChange={() => set("condition", "not_sure")} />
                    <span className="text-sm">Not sure</span>
                  </label>
                </div>
                {errors.condition && <p className="field-error" role="alert">{errors.condition}</p>}
              </fieldset>
              <fieldset data-error={Boolean(errors.recently_cleaned)} tabIndex={errors.recently_cleaned ? -1 : undefined}>
                <legend className="field-label">Has the home been professionally cleaned in the last 2 months?</legend>
                <div className="flex flex-wrap gap-2">
                  {(["yes", "no", "not_sure"] as const).map((v) => (
                    <label key={v} className="choice px-4 py-2.5">
                      <input type="radio" name="recent" className="accent-[var(--color-gold)]" checked={s.recently_cleaned === v} onChange={() => set("recently_cleaned", v)} />
                      <span className="text-sm">{v === "yes" ? "Yes" : v === "no" ? "No" : "Not sure"}</span>
                    </label>
                  ))}
                </div>
                {errors.recently_cleaned && <p className="field-error" role="alert">{errors.recently_cleaned}</p>}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <Stepper label="Pets" value={s.pets} min={0} max={20} onChange={(v) => set("pets", v)} />
                {s.pets > 0 && (
                  <Field label="Pet details" optional hint="Type, size, shedding, anything we should know">
                    {(p) => <input {...p} className="input" maxLength={300} value={s.pet_details} onChange={(e) => set("pet_details", e.target.value)} />}
                  </Field>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="Street address" error={errors.address_line1}>
                  {(p) => <input {...p} className="input" autoComplete="address-line1" value={s.address_line1} onChange={(e) => set("address_line1", e.target.value)} />}
                </Field>
                <Field label="Unit" optional>
                  {(p) => <input {...p} className="input" autoComplete="address-line2" value={s.unit} onChange={(e) => set("unit", e.target.value)} />}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="City" error={errors.city}>
                  {(p) => <input {...p} className="input" autoComplete="address-level2" value={s.city} onChange={(e) => set("city", e.target.value)} />}
                </Field>
                <Field label="ZIP code" error={errors.zip}>
                  {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={s.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, ""))} />}
                </Field>
              </div>
              <Field label="Occupancy or access needs" optional hint="e.g. home will be occupied, gated community, work-from-home hours">
                {(p) => <input {...p} className="input" maxLength={300} value={s.occupancy} onChange={(e) => set("occupancy", e.target.value)} />}
              </Field>
              <Field label="Anything else we should know?" optional>
                {(p) => <textarea {...p} className="input" maxLength={1000} value={s.special_requests} onChange={(e) => set("special_requests", e.target.value)} />}
              </Field>
            </div>
          )}

          {step === 2 && service && (
            <div className="space-y-8">
              <fieldset data-error={Boolean(errors.frequency)} tabIndex={errors.frequency ? -1 : undefined}>
                <legend className="field-label">How often?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {service.frequencies.map((f) => (
                    <label key={f} className="choice">
                      <input type="radio" name="frequency" className="mt-1 accent-[var(--color-gold)]" checked={s.frequency === f} onChange={() => set("frequency", f)} />
                      <span className="font-semibold">{FREQUENCY_LABELS[f]}</span>
                    </label>
                  ))}
                </div>
                {errors.frequency && <p className="field-error" role="alert">{errors.frequency}</p>}
                {s.frequency && s.frequency !== "one_time" && (
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-gold)]" checked={s.wants_recurring} onChange={(e) => set("wants_recurring", e.target.checked)} />
                    Keep the same day and time for future visits once confirmed
                  </label>
                )}
              </fieldset>
              {addons.length > 0 && (
                <fieldset>
                  <legend className="field-label">Optional extras</legend>
                  <p className="field-hint -mt-1 mb-3">Not included in the base cleaning. Choose any you&apos;d like added.</p>
                  <div className="grid gap-2">
                    {addons.map((a) => {
                      const q = s.addons[a.slug] ?? 0;
                      const price = `${a.starting_at ? "from " : ""}+${formatCents(a.price_cents)}${a.unit === "each" ? ` / ${a.unit_label}` : ""}`;
                      return (
                        <div key={a.slug} className="choice items-center" data-selected={q > 0}>
                          {a.unit === "flat" ? (
                            <label className="flex flex-1 cursor-pointer items-start gap-3">
                              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-gold)]" checked={q > 0} onChange={(e) => set("addons", { ...s.addons, [a.slug]: e.target.checked ? 1 : 0 })} />
                              <span>
                                <span className="block font-semibold">{a.name}</span>
                                <span className="block text-sm text-muted">{a.description}</span>
                              </span>
                            </label>
                          ) : (
                            <div className="flex-1">
                              <span className="block font-semibold">{a.name}</span>
                              <span className="block text-sm text-muted">{a.description}</span>
                            </div>
                          )}
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-sm font-semibold text-gold-ink whitespace-nowrap">{price}</span>
                            {a.unit === "each" && (
                              <MiniStepper label={`${a.name} quantity`} value={q} min={0} max={a.max_quantity} onChange={(v) => set("addons", { ...s.addons, [a.slug]: v })} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <fieldset>
                <legend className="field-label">Preferred time of day</legend>
                <div className="flex flex-wrap gap-2">
                  {(["morning", "afternoon", "flexible"] as const).map((w) => (
                    <label key={w} className="choice px-4 py-2.5">
                      <input type="radio" name="window" className="accent-[var(--color-gold)]" checked={s.preferred_window === w} onChange={() => set("preferred_window", w)} />
                      <span className="text-sm capitalize">{w}</span>
                    </label>
                  ))}
                </div>
                <p className="field-hint">You&apos;ll see real open times after your estimate.</p>
              </fieldset>
            </div>
          )}

          {step === 3 && (
            <div>
              {estimateState === "loading" && <Loading text="Calculating your estimate…" />}
              {estimateState === "error" && <ErrorBox text={estimateError} onRetry={fetchEstimate} />}
              {estimate && <EstimateCard estimate={estimate} frequency={s.frequency as Frequency} serviceName={service?.name ?? ""} />}
              {estimate && (
                <fieldset className="mt-6">
                  <legend className="field-label">What would you like to do next?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="choice">
                      <input type="radio" name="mode" className="mt-1 accent-[var(--color-gold)]" checked={s.mode === "book"} onChange={() => set("mode", "book")} />
                      <span><span className="block font-semibold">Request an appointment</span><span className="text-sm text-muted">Pick an open time now</span></span>
                    </label>
                    <label className="choice">
                      <input type="radio" name="mode" className="mt-1 accent-[var(--color-gold)]" checked={s.mode === "quote_only"} onChange={() => set("mode", "quote_only")} />
                      <span><span className="block font-semibold">Save my quote</span><span className="text-sm text-muted">We&apos;ll email it so you can decide later</span></span>
                    </label>
                  </div>
                </fieldset>
              )}
            </div>
          )}

          {step === 4 && (
            <div>
              {estimate && (
                <p className="mb-4 text-sm text-muted">
                  Estimated length: <strong className="text-charcoal">{minutesLabel(estimate.estimated_minutes)}</strong>. Times shown are arrival times that are open on our calendar right now.
                </p>
              )}
              {availState === "loading" && <Loading text="Checking the calendar…" />}
              {availState === "error" && <ErrorBox text={availError} onRetry={() => fetchDays(daysFrom)} />}
              {availState === "idle" && days.length > 0 && (
                <SlotPicker
                  days={days}
                  selectedDay={s.slot_day}
                  onDay={(d) => set("slot_day", d)}
                  slot={s.slot}
                  onSlot={(sl) => set("slot", sl)}
                  window={s.preferred_window}
                  canPrev={daysFrom !== null}
                  canNext={!horizonEnd || days[days.length - 1].date < horizonEnd}
                  onPrev={() => {
                    const d = new Date(`${days[0].date}T12:00:00`);
                    d.setDate(d.getDate() - 7);
                    const iso = d.toISOString().slice(0, 10);
                    void fetchDays(iso <= new Date().toISOString().slice(0, 10) ? null : iso);
                  }}
                  onNext={() => {
                    const d = new Date(`${days[days.length - 1].date}T12:00:00`);
                    d.setDate(d.getDate() + 1);
                    void fetchDays(d.toISOString().slice(0, 10));
                  }}
                />
              )}
              {errors.slot && <p className="field-error" role="alert" data-error="true" tabIndex={-1}>{errors.slot}</p>}
              <Field label="Scheduling preferences" optional hint="e.g. “Fridays work best” or “please avoid school pickup 2:30–3:30”" className="mt-6">
                {(p) => <textarea {...p} className="input" rows={3} maxLength={500} value={s.preferences} onChange={(e) => set("preferences", e.target.value)} />}
              </Field>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <p className="rounded-[var(--radius-control)] bg-cream/70 p-3 text-sm text-muted">Booked with us before? Use the same email and we&apos;ll connect this request to your existing account.</p>
              <Field label="Full name" error={errors.full_name}>
                {(p) => <input {...p} className="input" autoComplete="name" value={s.full_name} onChange={(e) => set("full_name", e.target.value)} />}
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Email" error={errors.email}>
                  {(p) => <input {...p} className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={s.email} onChange={(e) => set("email", e.target.value)} />}
                </Field>
                <Field label="Phone" error={errors.phone}>
                  {(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" value={s.phone} onChange={(e) => set("phone", e.target.value)} />}
                </Field>
              </div>
              <Field label="Best way to reach you">
                {(p) => (
                  <select {...p} className="input" value={s.preferred_contact} onChange={(e) => set("preferred_contact", e.target.value as State["preferred_contact"])}>
                    <option value="email">Email</option>
                    <option value="phone">Phone call</option>
                    <option value="text">Text message</option>
                  </select>
                )}
              </Field>
              {s.mode === "book" && (
                <Field label="Entry instructions" optional hint="Gate, parking, lockbox or key details. Only our team can see this, and it's never included in emails.">
                  {(p) => <textarea {...p} className="input" rows={3} maxLength={1000} value={s.access_instructions} onChange={(e) => set("access_instructions", e.target.value)} />}
                </Field>
              )}
              <Field label="Notes for our team" optional>
                {(p) => <textarea {...p} className="input" rows={3} maxLength={1000} value={s.notes} onChange={(e) => set("notes", e.target.value)} />}
              </Field>
              <label className="flex items-start gap-3 text-sm" data-error={Boolean(errors.consent)} tabIndex={errors.consent ? -1 : undefined}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-gold)]" checked={s.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={Boolean(errors.consent)} />
                <span>
                  I agree that {catalog.businessName} may contact me by email, phone or text about this request and appointment. See our{" "}
                  <Link href="/privacy" className="underline" target="_blank">privacy policy</Link>.
                </span>
              </label>
              {errors.consent && <p className="field-error" role="alert">{errors.consent}</p>}
              <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
                <label>Website<input id="qoc-website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
              </div>
            </div>
          )}

          {step === 6 && estimate && (
            <Review s={s} estimate={estimate} catalog={catalog} serviceName={service?.name ?? ""} addons={addons} onEdit={goTo} />
          )}
        </div>

        {submitState === "error" && (
          <div className="mt-6 flex gap-3 rounded-[var(--radius-control)] border border-danger/30 bg-status-declined-bg p-4 text-sm text-danger" role="alert">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">{submitError}</p>
              {s.mode === "book" && !s.slot && (
                <button type="button" className="mt-2 underline" onClick={() => { goTo(4); void fetchDays(null); }}>
                  Choose another time
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Navigation: sticky on phones so the next action is always in reach */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ivory/95 px-4 py-3 backdrop-blur sm:static sm:mt-10 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <button type="button" className="btn btn-ghost" onClick={back} disabled={step === 0 || submitState === "sending"}>
            <ChevronLeft className="size-4" aria-hidden /> Back
          </button>
          {step < 6 ? (
            <button type="button" className="btn btn-dark flex-1 sm:flex-none" onClick={next} disabled={(step === 3 && !estimate) || (step === 4 && availState === "loading")}>
              {step === 3 ? (s.mode === "book" ? "Choose a time" : "Continue") : "Continue"} <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : (
            <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={submit} disabled={submitState === "sending"}>
              {submitState === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Submitting…
                </>
              ) : s.mode === "book" ? (
                "Submit booking request"
              ) : (
                "Email me my quote"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <span className="field-label" id={`lbl-${label}`}>{label}</span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={`lbl-${label}`}>
        <button type="button" className="btn btn-outline size-11 p-0" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          <Minus className="size-4" aria-hidden />
        </button>
        <output className="w-10 text-center text-lg font-bold" aria-live="polite">{value}</output>
        <button type="button" className="btn btn-outline size-11 p-0" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function MiniStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn btn-outline size-9 min-h-0 p-0" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease">
        <Minus className="size-3.5" aria-hidden />
      </button>
      <output className="w-7 text-center font-bold">{value}</output>
      <button type="button" className="btn btn-outline size-9 min-h-0 p-0" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase">
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="card flex items-center gap-3 p-6 text-muted" role="status">
      <Loader2 className="size-5 animate-spin text-gold" aria-hidden /> {text}
    </div>
  );
}

function ErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="card border-danger/30 p-6" role="alert">
      <p className="font-semibold text-danger">{text}</p>
      <button type="button" className="btn btn-outline btn-sm mt-3" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function EstimateCard({ estimate, frequency, serviceName }: { estimate: Estimate; frequency: Frequency; serviceName: string }) {
  if (estimate.mode === "custom") {
    return (
      <div className="card p-6">
        <p className="eyebrow">Custom quote</p>
        <p className="mt-2 font-display text-3xl">We&apos;ll prepare a custom price</p>
        <p className="mt-2 text-sm text-muted">Custom requests are priced after we review your details. You can still request a time — nothing is confirmed until we reply.</p>
      </div>
    );
  }
  return (
    <div className="frame overflow-hidden rounded-sm bg-[#fffdf8]">
      <div className="on-dark bg-obsidian px-6 py-6 text-ivory">
        <p className="eyebrow">{estimate.requires_review ? "Estimate · subject to review" : "Estimate"}</p>
        <p className="mt-1 text-sm text-ivory/70">{serviceName} · {FREQUENCY_LABELS[frequency]}</p>
        <p className="gold-text mt-2 font-display text-5xl font-semibold">{formatCents(estimate.total_cents)}</p>
        <p className="text-sm text-ivory/70">{estimate.recurring_per_visit_cents !== null ? "per visit" : "one-time"} · about {minutesLabel(estimate.estimated_minutes)} of cleaning</p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Estimate breakdown</caption>
        <tbody>
          {estimate.lines.map((l, i) => (
            <tr key={i} className="border-b border-line/70">
              <td className="px-6 py-2.5">{l.label}</td>
              <td className="px-6 py-2.5 text-right tabular-nums">{l.amount_cents < 0 ? "−" : ""}{formatCents(Math.abs(l.amount_cents))}</td>
            </tr>
          ))}
          <tr>
            <td className="px-6 py-3 font-bold">Estimated total</td>
            <td className="px-6 py-3 text-right font-bold tabular-nums">{formatCents(estimate.total_cents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="space-y-2 border-t border-line px-6 py-4 text-sm text-muted">
        {estimate.area_message && <p className="font-semibold text-status-pending">{estimate.area_message}</p>}
        {estimate.review_reasons.filter((r) => r !== estimate.area_message).map((r) => <p key={r} className="font-semibold text-status-pending">{r}</p>)}
        {estimate.notes.map((n) => <p key={n}>{n}</p>)}
        <p>This is an estimate, not a final price. If the home&apos;s condition or the scope is different from what you described — for example heavy buildup — the price may change, and we&apos;ll always discuss it with you first.</p>
      </div>
    </div>
  );
}

function SlotPicker(props: {
  days: Day[];
  selectedDay: string;
  onDay: (d: string) => void;
  slot: Slot | null;
  onSlot: (s: Slot) => void;
  window: "morning" | "afternoon" | "flexible";
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const day = props.days.find((d) => d.date === props.selectedDay) ?? props.days[0];
  const anyOpen = props.days.some((d) => d.slots.length > 0);
  const isMorning = (label: string) => label.endsWith("AM");
  const groups = [
    { name: "Morning", slots: day.slots.filter((x) => isMorning(x.label)) },
    { name: "Afternoon", slots: day.slots.filter((x) => !isMorning(x.label)) },
  ];
  if (props.window === "afternoon") groups.reverse();
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={props.onPrev} disabled={!props.canPrev} aria-label="Previous week">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <p className="text-sm font-semibold">{props.days[0].label} – {props.days[props.days.length - 1].label}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={props.onNext} disabled={!props.canNext} aria-label="Next week">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <div className="-mx-1 mt-3 flex snap-x gap-2 overflow-x-auto px-1 pb-2" role="radiogroup" aria-label="Day">
        {props.days.map((d) => {
          const [dow, ...rest] = d.label.split(", ");
          const sel = d.date === day.date;
          return (
            <button
              key={d.date}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => props.onDay(d.date)}
              disabled={d.slots.length === 0}
              className={`flex min-w-[4.5rem] snap-start flex-col items-center rounded-[var(--radius-control)] border px-2 py-2 text-sm transition ${sel ? "border-gold bg-obsidian text-champagne" : "border-line bg-[#fffdf8] hover:border-champagne"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span className="text-xs font-bold uppercase tracking-wide">{dow}</span>
              <span className="font-semibold">{rest.join(", ")}</span>
              <span className="text-[0.7rem] opacity-80">{d.slots.length ? `${d.slots.length} open` : "Full"}</span>
            </button>
          );
        })}
      </div>
      {!anyOpen ? (
        <p className="mt-4 rounded-[var(--radius-control)] bg-cream/70 p-4 text-sm">No open times this week. Try the next week, or choose “Save my quote” and we&apos;ll reach out to schedule.</p>
      ) : day.slots.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No open times on this day.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.filter((g) => g.slots.length).map((g) => (
            <div key={g.name}>
              <p className="eyebrow">{g.name}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={`${g.name} times`}>
                {g.slots.map((sl) => {
                  const sel = props.slot?.start === sl.start;
                  return (
                    <button key={sl.start} type="button" role="radio" aria-checked={sel} onClick={() => props.onSlot(sl)} className={`min-h-11 rounded-[var(--radius-control)] border text-sm font-semibold transition ${sel ? "border-gold bg-gold text-obsidian" : "border-line bg-[#fffdf8] hover:border-gold"}`}>
                      {sl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {props.slot && (
        <p className="mt-4 text-sm font-semibold text-gold-ink" role="status">
          Selected: {new Date(props.slot.start).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (Las Vegas time)
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function Section({ title, step, onEdit, children }: { title: string; step: number; onEdit: (i: number) => void; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{title}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(step)}>Edit</button>
      </div>
      <dl className="mt-2 divide-y divide-line/60">{children}</dl>
    </section>
  );
}

function Review({ s, estimate, catalog, serviceName, addons, onEdit }: { s: State; estimate: Estimate; catalog: WizardCatalog; serviceName: string; addons: WizardCatalog["addons"]; onEdit: (i: number) => void }) {
  const chosenAddons = addons.filter((a) => (s.addons[a.slug] ?? 0) > 0);
  return (
    <div className="space-y-4">
      <Section onEdit={onEdit} title="Service" step={0}>
        <Row k="Service" v={serviceName} />
        <Row k="Frequency" v={FREQUENCY_LABELS[s.frequency as Frequency]} />
        <Row k="Extras" v={chosenAddons.length ? chosenAddons.map((a) => `${a.name}${a.unit === "each" ? ` ×${s.addons[a.slug]}` : ""}`).join(", ") : "None"} />
      </Section>
      <Section onEdit={onEdit} title="Your home" step={1}>
        <Row k="Address" v={`${s.address_line1}${s.unit ? `, ${s.unit}` : ""}, ${s.city} ${s.zip}`} />
        <Row k="Rooms" v={`${s.bedrooms} bed · ${s.full_baths} full bath${s.half_baths ? ` · ${s.half_baths} half` : ""}`} />
        <Row k="Size" v={s.sqft_unknown ? "Not sure" : `${Number(s.sqft).toLocaleString()} sq ft`} />
        <Row k="Condition" v={s.condition === "not_sure" ? "Not sure" : CONDITION_LABELS[s.condition as Condition]} />
        <Row k="Pets" v={s.pets ? `${s.pets}${s.pet_details ? ` — ${s.pet_details}` : ""}` : "None"} />
      </Section>
      <Section onEdit={onEdit} title="Estimate" step={3}>
        {estimate.mode === "custom" ? <Row k="Price" v="Custom quote after review" /> : estimate.lines.map((l, i) => <Row key={i} k={l.label} v={formatCents(l.amount_cents)} />)}
        {estimate.mode !== "custom" && <Row k={<strong>Estimated total</strong>} v={<strong>{formatCents(estimate.total_cents)}</strong>} />}
      </Section>
      {s.mode === "book" && s.slot && (
        <Section onEdit={onEdit} title="Requested time" step={4}>
          <Row k="Arrival" v={new Date(s.slot.start).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} />
          <Row k="Estimated length" v={minutesLabel(estimate.estimated_minutes)} />
          {s.preferences && <Row k="Preferences" v={s.preferences} />}
        </Section>
      )}
      <Section onEdit={onEdit} title="Contact" step={5}>
        <Row k="Name" v={s.full_name} />
        <Row k="Email" v={s.email} />
        <Row k="Phone" v={s.phone} />
        <Row k="Preferred contact" v={s.preferred_contact === "text" ? "Text message" : s.preferred_contact === "phone" ? "Phone call" : "Email"} />
        {s.access_instructions && <Row k="Entry instructions" v="Provided (private)" />}
      </Section>
      <div className="rounded-[var(--radius-card)] border border-status-pending/40 bg-status-pending-bg/60 p-5 text-sm">
        {s.mode === "book" ? (
          <>
            <p className="font-bold text-status-pending">Your appointment is not confirmed yet.</p>
            <p className="mt-1">After you submit, your request will show as <strong>Pending Review</strong>. {catalog.responseTime}</p>
          </>
        ) : (
          <p>We&apos;ll save your estimate and email you a secure link to review and accept it.{estimate.requires_review ? " Because your request needs a quick review, we'll confirm the price before sending it." : ""}</p>
        )}
      </div>
      <details className="card p-5 text-sm">
        <summary className="cursor-pointer font-semibold">Cancellation &amp; rescheduling policy</summary>
        <p className="mt-3 whitespace-pre-line text-muted">{catalog.policies.cancellation}</p>
        <p className="mt-3 whitespace-pre-line text-muted">{catalog.policies.reschedule}</p>
      </details>
    </div>
  );
}

function Confirmation({ result, catalog }: { result: Result; catalog: WizardCatalog }) {
  const isAppt = result.kind === "appointment";
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6" role="status">
      <div className="frame rounded-sm bg-[#fffdf8] p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-obsidian">
          <Check className="size-7 text-champagne" aria-hidden />
        </div>
        <h2 tabIndex={-1} className="mt-5 text-4xl font-semibold">{isAppt ? "Request received" : "Quote saved"}</h2>
        <p className="mt-2 text-muted">Reference <strong className="font-mono text-charcoal">{result.reference}</strong></p>
        {isAppt ? (
          <p className="mt-5">
            Status:{" "}
            <strong className={result.status === "confirmed" ? "text-status-completed" : "text-status-pending"}>
              {result.status === "confirmed" ? "Confirmed" : "Pending review — not confirmed yet"}
            </strong>
          </p>
        ) : (
          <p className="mt-5">{result.status === "draft" ? "We'll review your details and email you a confirmed quote." : "Your quote is ready."}</p>
        )}
        <p className="mt-3 text-sm text-muted">{catalog.responseTime}</p>
        <p className="mt-3 text-sm text-muted">
          {result.email === "sent"
            ? "We've emailed you a copy."
            : result.email === "failed"
              ? "We couldn't send the confirmation email, but your request is saved. Save your reference number."
              : "Save your reference number — we'll contact you using the details you provided."}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {result.manage_url && <Link href={result.manage_url} className="btn btn-dark">View or change my request</Link>}
          {result.quote_url && <a href={result.quote_url} className="btn btn-dark">View my quote</a>}
          <Link href="/" className="btn btn-outline">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
