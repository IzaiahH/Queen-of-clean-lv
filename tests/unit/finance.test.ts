import { describe, expect, it } from "vitest";
import { estimatedLaborCents, jobProfit, laborPay, monthlyRecurringProjection, periodSummary } from "@/lib/finance/calc";

describe("finance", () => {
  it("computes labor pay for each compensation model", () => {
    expect(laborPay("hourly", 2200, 0, 180, 18500).pay_cents).toBe(6600);
    expect(laborPay("per_job", 9000, 0, 180, 18500).pay_cents).toBe(9000);
    expect(laborPay("percent", 0, 40, 180, 20000, 2).pay_cents).toBe(4000);
  });
  it("estimates labor across a crew", () => {
    expect(estimatedLaborCents([{ pay_method: "hourly", pay_rate_cents: 2400, pay_percent: 0 }, { pay_method: "hourly", pay_rate_cents: 2400, pay_percent: 0 }], 240, 30000)).toBe(9600);
  });
  it("job profit = recorded revenue − recorded direct costs", () => {
    expect(jobProfit({ revenue_cents: 18500, labor_cents: 6600, supplies_cents: 900, other_cost_cents: 0 })).toEqual({ direct_cost_cents: 7500, profit_cents: 11000, margin_pct: 59.5 });
    expect(jobProfit({ revenue_cents: 0, labor_cents: 0, supplies_cents: 0, other_cost_cents: 0 }).margin_pct).toBeNull();
  });
  it("operating profit subtracts business expenses but never counts booked revenue", () => {
    const s = periodSummary({ completed_revenue_cents: 50000, booked_revenue_cents: 99999, labor_cents: 20000, job_supplies_cents: 2000, job_other_cents: 0, expenses_cents: 5000, estimated_expenses_cents: 0 });
    expect(s.gross_profit_cents).toBe(28000);
    expect(s.operating_profit_cents).toBe(23000);
  });
  it("projects recurring monthly revenue", () => {
    expect(monthlyRecurringProjection("biweekly", 18500)).toBe(40083);
    expect(monthlyRecurringProjection("monthly", 21000)).toBe(21000);
  });
});
