import { LegalPage } from "@/components/public/LegalPage";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy policy" };

export default async function Page() {
  const s = await getSettings();
  return <LegalPage title="Privacy policy" draft={!s.policies.policies_reviewed} body={s.policies.privacy_policy} />;
}
