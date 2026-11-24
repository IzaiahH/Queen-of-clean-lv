-- Queen of Clean LV: upgrade an EXISTING database from the original setup to Phases 2 and 3.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Run it once.
-- Additive only: adds columns, two tables and one allowed customer status. Deletes or changes no data.
-- All-or-nothing: if any step fails, nothing is applied. If it was already applied, it stops with a clear message.
-- Contains no customer data.

begin;

do $$
begin
  if not exists (select 1 from schema_migrations where name = '20261012000000_init.sql') then
    raise exception 'This database was not set up with supabase/setup.sql. Stopping; nothing was changed.';
  end if;
  if exists (select 1 from schema_migrations where name in ('20261123000000_intake_and_images.sql', '20261124000000_customer_rates.sql')) then
    raise exception 'This upgrade was already applied. Nothing was changed.';
  end if;
end $$;

-- ── migration 20261123000000_intake_and_images.sql ──
-- Phase 2: richer property intake and private image storage.
-- Additive only: no existing column or row is changed.

alter table properties
  add column if not exists flooring text[] not null default '{}',
  add column if not exists parking_instructions text not null default '';   -- sensitive: staff-only, like access_instructions

-- Images uploaded through the site.
--   property_photo: sent by a customer with a quote/booking request. Private: staff only, never public.
--   site_image:     uploaded by an owner/admin for the website (e.g. the homepage hero). Public.
-- Every upload is decoded and re-encoded on the server (strips EXIF, including GPS location) before it is stored.
create table if not exists uploaded_images (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('property_photo','site_image')),
  content_type text not null check (content_type in ('image/jpeg','image/webp')),
  bytes bytea not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3000000),
  width integer not null check (width between 1 and 4000),
  height integer not null check (height between 1 and 4000),
  -- Customer uploads: only the browser that uploaded a photo holds the key needed to attach or remove it.
  upload_key_hash text,
  quote_id uuid references quotes(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  customer_id uuid references customers(id) on delete cascade,
  uploaded_by uuid references profiles(id) on delete set null,
  attached_at timestamptz,
  created_at timestamptz not null default now(),
  check (purpose = 'site_image' or upload_key_hash is not null)
);
create index if not exists uploaded_images_quote_idx on uploaded_images(quote_id) where quote_id is not null;
create index if not exists uploaded_images_appointment_idx on uploaded_images(appointment_id) where appointment_id is not null;
create index if not exists uploaded_images_customer_idx on uploaded_images(customer_id) where customer_id is not null;
create index if not exists uploaded_images_unattached_idx on uploaded_images(created_at) where purpose = 'property_photo' and attached_at is null;

alter table uploaded_images enable row level security;
revoke all on uploaded_images from anon;
create policy uploaded_images_admin_all on uploaded_images for all to authenticated
  using (public.app_role() in ('owner','admin')) with check (public.app_role() in ('owner','admin'));
create policy uploaded_images_office_all on uploaded_images for all to authenticated
  using (public.app_role() = 'office') with check (public.app_role() = 'office');
insert into schema_migrations (name) values ('20261123000000_intake_and_images.sql');

-- ── migration 20261124000000_customer_rates.sql ──
-- Phase 3: existing-customer import and customer-specific (historical) pricing.
-- Additive: one status value is added to the allowed list, nothing existing is changed.

-- "Existing client — verify current status": imported records stay out of active-customer
-- counts until someone confirms they're still a client.
alter table customers drop constraint if exists customers_status_check;
alter table customers add constraint customers_status_check
  check (status in ('lead','active','inactive','archived','unverified'));

alter table customers
  -- Stable key from the source records. Makes re-running an import safe (one customer per key, ever).
  add column if not exists import_ref text,
  add column if not exists preferred_frequency text
    check (preferred_frequency in ('weekly','biweekly','monthly','quarterly','one_time'));
create unique index if not exists customers_import_ref_key on customers(import_ref) where import_ref is not null;

-- Rates agreed with one specific customer. Kept apart from pricing_versions on purpose:
-- the public pricing engine never reads this table, and these rates are never recalculated.
create table if not exists customer_rates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  service_slug text not null default 'recurring',
  frequency text not null check (frequency in ('weekly','biweekly','monthly','quarterly','one_time')),
  price_cents integer not null check (price_cents > 0 and price_cents <= 1000000),
  basis text not null default 'per_visit' check (basis in ('per_visit')),
  kind text not null check (kind in ('historical','custom')),
  status text not null default 'active' check (status in ('active','retired')),
  source text not null check (source in ('import','admin')),
  import_ref text,
  notes text not null default '',
  created_by uuid references profiles(id) on delete set null,
  retired_at timestamptz,
  retired_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'retired') = (retired_at is not null))
);
-- One active rate per customer, service and frequency. Changing a rate retires the old row (history is kept).
create unique index if not exists customer_rates_one_active on customer_rates(customer_id, service_slug, frequency) where status = 'active';
create unique index if not exists customer_rates_import_ref_key on customer_rates(import_ref) where import_ref is not null;
create index if not exists customer_rates_customer_idx on customer_rates(customer_id);
create trigger customer_rates_touch before update on customer_rates for each row execute function touch_updated_at();

alter table customer_rates enable row level security;
revoke all on customer_rates from anon;
create policy customer_rates_admin_all on customer_rates for all to authenticated
  using (public.app_role() in ('owner','admin')) with check (public.app_role() in ('owner','admin'));
-- Office staff book visits, so they can read rates but not change them.
create policy customer_rates_office_read on customer_rates for select to authenticated
  using (public.app_role() = 'office');
insert into schema_migrations (name) values ('20261124000000_customer_rates.sql');

commit;

-- Check: should list all three names.
select name, applied_at from schema_migrations order by name;
