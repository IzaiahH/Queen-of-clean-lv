/**
 * Imports the business's existing customers and their historical rates.
 *
 *   npm run import:existing -- private/existing-customers.json            # dry run (default): nothing is saved
 *   npm run import:existing -- private/existing-customers.json --apply    # save
 *
 * Safe to run any number of times. Writes a report next to the source file.
 * Refuses any database that isn't on this computer unless you add --allow-remote-database,
 * so a production database is never changed by accident.
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv } from "./env";
import { formatReport, importExistingCustomers } from "../src/lib/import/existing-customers";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  if (!file) {
    console.error("Usage: npm run import:existing -- <file.json> [--apply] [--allow-remote-database]");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  if (!local && !args.includes("--allow-remote-database")) {
    console.error("DATABASE_URL points to a database that isn't on this computer. Refusing. Add --allow-remote-database only when you mean it.");
    process.exit(3);
  }
  const sql = postgres(url, { prepare: false, max: 2, onnotice: () => {} });
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const report = await importExistingCustomers(sql as never, data, { apply, actor: { id: null, label: "Import script" } });
    const text = formatReport(report);
    const out = `${file.replace(/\.json$/i, "")}.report-${report.mode}-${report.ran_at.slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    writeFileSync(out, text + "\n");
    console.log(text);
    console.log(`\nReport saved to ${out}`);
    if (report.totals.error > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
