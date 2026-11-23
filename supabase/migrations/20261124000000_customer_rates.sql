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
