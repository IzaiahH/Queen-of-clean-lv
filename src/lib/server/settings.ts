import "server-only";
import { cache } from "react";
import { db, type Tx } from "@/lib/db";
import { DEFAULT_SETTINGS, settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/schema";

export async function loadSettings(tx: Tx = db()): Promise<Settings> {
  const rows = await tx<{ key: string; value: unknown }[]>`select key, value from settings`;
  const out = structuredClone(DEFAULT_SETTINGS) as Settings;
  for (const row of rows) {
    if (!(row.key in settingsSchemas)) continue;
    const key = row.key as SettingsKey;
    const merged =
      key === "email_templates"
        ? { ...DEFAULT_SETTINGS.email_templates, ...(row.value as object) }
        : { ...(DEFAULT_SETTINGS[key] as object), ...(row.value as object) };
    const parsed = settingsSchemas[key].safeParse(merged);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
    else console.error(`Invalid stored setting "${key}", using defaults`, parsed.error.issues);
  }
  return out;
}

/** Per-request cached settings for server components. */
export const getSettings = cache(() => loadSettings());

export async function saveSetting<K extends SettingsKey>(key: K, value: Settings[K], profileId: string | null, tx: Tx = db()) {
  const parsed = settingsSchemas[key].parse(value);
  await tx`
    insert into settings (key, value, updated_by, updated_at)
    values (${key}, ${tx.json(parsed as never)}, ${profileId}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
}
