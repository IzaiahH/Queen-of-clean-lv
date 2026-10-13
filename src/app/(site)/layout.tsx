import { SiteFooter } from "@/components/public/SiteFooter";
import { SiteHeader } from "@/components/public/SiteHeader";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { business } = await getSettings();
  const logo = business.logo_data_url ? `/brand/logo?v=${business.logo_data_url.length}` : null;
  return (
    <>
      <SiteHeader businessName={business.name} phone={business.phone} logo={logo} />
      <main id="main">{children}</main>
      <SiteFooter name={business.name} tagline={business.tagline} phone={business.phone} email={business.email} hours={business.hours_text} logo={logo} />
    </>
  );
}
