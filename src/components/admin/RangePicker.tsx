"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  ["today", "Today"], ["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["custom", "Custom…"],
] as const;

export function RangePicker({ current, fromISO, toISO }: { current: string; fromISO: string; toISO: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const go = (params: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="sr-only">Date range</span>
        <select className="input min-h-10 py-1.5" value={current} onChange={(e) => go({ range: e.target.value, from: fromISO, to: toISO })}>
          {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {current === "custom" && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); go({ range: "custom", from: String(f.get("from")), to: String(f.get("to")) }); }}>
          <label className="text-xs">From<input name="from" type="date" defaultValue={fromISO} className="input min-h-10 py-1.5" /></label>
          <label className="text-xs">To<input name="to" type="date" defaultValue={toISO} className="input min-h-10 py-1.5" /></label>
          <button className="btn btn-dark btn-sm">Apply</button>
        </form>
      )}
    </div>
  );
}
