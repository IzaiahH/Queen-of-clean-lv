import { DateTime } from "luxon";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { ImportWizard } from "@/components/admin/ImportWizard";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { recentImports } from "@/lib/server/importer";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Import / Export" };

export default async function ImportExportPage() {
  const user = await requirePage("data.import");
  const tz = (await getSettings()).booking.timezone;
  const imports = await recentImports();
  const now = DateTime.now().setZone(tz);
  const yearQ = `from=${now.startOf("year").toISODate()}&to=${now.endOf("year").toISODate()}`;
  const nextQ = `from=${now.toISODate()}&to=${now.plus({ days: 90 }).toISODate()}`;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data" title="Import / Export" />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Import customers</h2>
          <p className="text-sm text-muted">Bring in your existing customer list from Excel or Google Sheets. You&apos;ll match columns, review every row, and confirm before anything is saved. Imported customer data stays private to signed-in staff.</p>
          <ImportWizard />
        </section>
        <aside className="space-y-6">
          {can(user.role, "data.export") && (
            <section className="card space-y-2 p-5">
              <h2 className="text-2xl font-semibold">Export</h2>
              <p className="text-xs text-muted">CSV files open in Excel and Google Sheets. Access instructions and private notes are never included.</p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler, not a page */}
              <a className="btn btn-outline btn-sm w-full justify-start" href="/api/admin/export/customers"><Download className="size-4" aria-hidden />All customers</a>
              <a className="btn btn-outline btn-sm w-full justify-start" href={`/api/admin/export/appointments?${yearQ}`}><Download className="size-4" aria-hidden />Appointments this year</a>
              <a className="btn btn-outline btn-sm w-full justify-start" href={`/api/admin/export/appointments?${nextQ}`}><Download className="size-4" aria-hidden />Appointments next 90 days</a>
              <a className="btn btn-outline btn-sm w-full justify-start" href={`/api/admin/export/jobs?${yearQ}`}><Download className="size-4" aria-hidden />Job profit this year</a>
              <a className="btn btn-outline btn-sm w-full justify-start" href={`/api/admin/export/expenses?${yearQ}`}><Download className="size-4" aria-hidden />Expenses this year</a>
            </section>
          )}
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Recent imports</h2>
            {imports.length === 0 ? <p className="mt-2 text-sm text-muted">None yet.</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">{imports.map((i) => (
                <li key={i.id} className="py-2"><span className="font-semibold">{i.filename}</span><span className="block text-xs text-muted">{formatDateTime(i.created_at, tz)} · {i.status === "committed" ? `${i.summary.created ?? 0} imported` : i.status === "review" ? "Not finished" : "Discarded"}</span></li>
              ))}</ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
