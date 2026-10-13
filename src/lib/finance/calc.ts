/**
 * Every financial formula lives here so screens never re-derive numbers differently.
 * Vocabulary:
 *  - estimated: a quote amount not yet accepted (never revenue)
 *  - booked: agreed price of pending/confirmed appointments (expected, not earned)
 *  - completed revenue: recorded revenue on completed jobs (earned)
 *  - direct costs: recorded labor pay + supplies + other job costs on completed jobs
 *  - job profit: completed revenue − direct costs
 *  - operating profit: job profit − business expenses not tied to a job
 */

export type PayMethod = "hourly" | "per_job" | "percent";

export function laborPay(
  method: PayMethod,
  rateCents: number,
  percent: number,
  minutes: number,
  jobRevenueCents: number,
  crewSize = 1,
): { pay_cents: number; basis: string } {
  switch (method) {
    case "hourly": {
      const pay = Math.round((rateCents * minutes) / 60);
      return { pay_cents: pay, basis: `hourly $${(rateCents / 100).toFixed(2)} × ${(minutes / 60).toFixed(2)} h` };
    }
    case "per_job":
      return { pay_cents: rateCents, basis: `flat $${(rateCents / 100).toFixed(2)} per job` };
    case "percent": {
      const share = Math.round((jobRevenueCents * percent) / 100 / Math.max(1, crewSize));
      return { pay_cents: share, basis: `${percent}% of $${(jobRevenueCents / 100).toFixed(2)}${crewSize > 1 ? ` ÷ ${crewSize} cleaners` : ""}` };
    }
  }
}

/** Labor-cost estimate for a scheduled job (before anyone clocks in). */
export function estimatedLaborCents(
  cleaners: { pay_method: PayMethod; pay_rate_cents: number; pay_percent: number }[],
  estimatedMinutes: number,
  priceCents: number,
): number {
  if (cleaners.length === 0) return 0;
  const perCleanerMinutes = Math.round(estimatedMinutes / cleaners.length);
  return cleaners.reduce(
    (sum, c) => sum + laborPay(c.pay_method, c.pay_rate_cents, Number(c.pay_percent), perCleanerMinutes, priceCents, cleaners.length).pay_cents,
    0,
  );
}

export type JobMoney = {
  revenue_cents: number;
  labor_cents: number;
  supplies_cents: number;
  other_cost_cents: number;
};

export function jobProfit(j: JobMoney) {
  const direct = j.labor_cents + j.supplies_cents + j.other_cost_cents;
  const profit = j.revenue_cents - direct;
  return {
    direct_cost_cents: direct,
    profit_cents: profit,
    margin_pct: j.revenue_cents > 0 ? Math.round((profit / j.revenue_cents) * 1000) / 10 : null,
  };
}

export type PeriodTotals = {
  completed_revenue_cents: number;
  booked_revenue_cents: number;
  labor_cents: number;
  job_supplies_cents: number;
  job_other_cents: number;
  expenses_cents: number; // business expenses not attached to a completed job's record
  estimated_expenses_cents: number;
};

export function periodSummary(t: PeriodTotals) {
  const direct = t.labor_cents + t.job_supplies_cents + t.job_other_cents;
  const grossProfit = t.completed_revenue_cents - direct;
  const operatingProfit = grossProfit - t.expenses_cents;
  return {
    ...t,
    direct_cost_cents: direct,
    gross_profit_cents: grossProfit,
    operating_profit_cents: operatingProfit,
    operating_margin_pct: t.completed_revenue_cents > 0 ? Math.round((operatingProfit / t.completed_revenue_cents) * 1000) / 10 : null,
  };
}

/** Projected monthly revenue from an active recurring schedule (a projection, never earned revenue). */
export function monthlyRecurringProjection(frequency: string, pricePerVisitCents: number, intervalDays?: number | null): number {
  const visitsPerMonth: Record<string, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3 };
  const v = frequency === "custom" && intervalDays ? 365 / 12 / intervalDays : visitsPerMonth[frequency] ?? 0;
  return Math.round(pricePerVisitCents * v);
}
