import { LegalPage } from "@/components/public/LegalPage";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms of service" };

export default async function Page() {
  const s = await getSettings();
  return (
    <LegalPage
      title="Terms of service"
      draft={!s.policies.policies_reviewed}
      body={s.policies.terms_of_service}
      sections={[
        { title: "Cancellations", body: s.policies.cancellation_policy },
        { title: "Rescheduling", body: s.policies.reschedule_policy },
      ]}
    />
  );
}
