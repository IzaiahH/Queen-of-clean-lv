-- Queen of Clean LV — initial schema
-- Works on Supabase Postgres and on plain Postgres 15+ (run db/local-bootstrap.sql first locally).
-- Money is stored as integer cents. All instants are timestamptz (UTC); the app renders
-- them in the business timezone (America/Los_Angeles by default).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Staff, auth and settings
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                -- Supabase auth.users.id when AUTH_PROVIDER=supabase
  email text not null,
  full_name text not null,
  role text not null check (role in ('owner','admin','office','cleaner')),
  cleaner_id uuid,                         -- set for role = 'cleaner'
  password_hash text,                      -- only used when AUTH_PROVIDER=local
  active boolean not null default true,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on profiles (lower(email));

create table sessions (
  id text primary key,                     -- sha256 of the session token; raw token only lives in the cookie
  profile_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text
);
create index sessions_profile_idx on sessions(profile_id);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table service_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  zip_codes text[] not null default '{}',
  travel_fee_cents integer not null default 0 check (travel_fee_cents >= 0),
  requires_review boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index service_areas_name_key on service_areas (lower(name));

-- ---------------------------------------------------------------------------
-- Catalog and pricing
-- ---------------------------------------------------------------------------
create table services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  short_description text not null default '',
  description text not null default '',
  includes text[] not null default '{}',
  excludes text[] not null default '{}',
  kind text not null check (kind in ('recurring','standard','deep','move','turnover','custom')),
  allowed_frequencies text[] not null default '{one_time}',
  requires_review boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table addons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null default '',
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every price-affecting number lives in a versioned JSON document validated by the app
-- (src/lib/pricing/rules.ts). Quotes reference the version they were calculated with.
create table pricing_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status text not null check (status in ('draft','published','archived')),
  rules jsonb not null,
  notes text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references profiles(id) on delete set null
);
create unique index pricing_one_published on pricing_versions ((status)) where status = 'published';
create unique index pricing_one_draft on pricing_versions ((status)) where status = 'draft';

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  phone_digits text generated always as (nullif(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '')) stored,
  preferred_contact text not null default 'email' check (preferred_contact in ('email','phone','text')),
  status text not null default 'active' check (status in ('lead','active','inactive','archived')),
  customer_since date,
  preferences text not null default '',
  private_notes text not null default '',
  source text not null default 'admin' check (source in ('website','admin','import','referral')),
  marketing_consent boolean not null default false,
  booking_comms_consent boolean not null default false,
  merged_into_id uuid references customers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_email_idx on customers (lower(email));
create index customers_phone_idx on customers (phone_digits);
create index customers_name_idx on customers (lower(full_name));
create index customers_status_idx on customers (status);

create table properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null default 'Home',
  address_line1 text,                      -- nullable: imported records may lack an address until reviewed
  unit text,
  city text not null default 'Las Vegas',
  state text not null default 'NV',
  zip text,
  service_area_id uuid references service_areas(id) on delete set null,
  property_type text not null default 'house' check (property_type in ('house','townhome','condo','apartment','other')),
  bedrooms integer check (bedrooms between 0 and 20),
  full_baths integer check (full_baths between 0 and 20),
  half_baths integer not null default 0 check (half_baths between 0 and 20),
  sqft integer check (sqft between 100 and 50000),
  pets text not null default '',
  condition text check (condition in ('light','standard','heavy','extreme')),
  access_instructions text not null default '',   -- sensitive: staff-only
  special_requirements text not null default '',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_customer_idx on properties(customer_id);

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
create table quotes (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  service_slug text not null,
  frequency text not null,
  inputs jsonb not null,
  pricing_version_id uuid not null references pricing_versions(id) on delete restrict,
  estimate_cents integer not null check (estimate_cents >= 0),
  recurring_cents integer check (recurring_cents >= 0),
  estimated_minutes integer not null check (estimated_minutes > 0),
  breakdown jsonb not null,
  requires_review boolean not null default false,
  review_reasons text[] not null default '{}',
  status text not null default 'pending_customer' check (status in ('draft','sent','pending_customer','accepted','declined','expired')),
  override_cents integer check (override_cents >= 0),
  override_reason text,
  override_by uuid references profiles(id) on delete set null,
  override_at timestamptz,
  source text not null default 'website' check (source in ('website','admin')),
  public_token_hash text unique,
  idempotency_key text unique,
  expires_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_status_idx on quotes(status, created_at desc);
create index quotes_customer_idx on quotes(customer_id);

create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  kind text not null,
  label text not null,
  quantity numeric(8,2) not null default 1,
  amount_cents integer not null,
  sort integer not null default 0
);
create index quote_line_items_quote_idx on quote_line_items(quote_id);

-- ---------------------------------------------------------------------------
-- Cleaners
-- ---------------------------------------------------------------------------
create table cleaners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  color text not null default '#8E6B2E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  capabilities text[] not null default '{}',    -- service slugs this person can perform; empty = all
  worker_type text not null default 'unspecified' check (worker_type in ('unspecified','employee','contractor','owner','other')),
  pay_method text not null default 'hourly' check (pay_method in ('hourly','per_job','percent')),
  pay_rate_cents integer not null default 0 check (pay_rate_cents >= 0),   -- hourly or per job
  pay_percent numeric(5,2) not null default 0 check (pay_percent between 0 and 100),
  max_jobs_per_day integer check (max_jobs_per_day between 1 and 12),
  private_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles add constraint profiles_cleaner_fk foreign key (cleaner_id) references cleaners(id) on delete set null;

create table cleaner_working_hours (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references cleaners(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7),  -- ISO: 1 = Monday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index cleaner_hours_idx on cleaner_working_hours(cleaner_id, weekday);

create table cleaner_time_off (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references cleaners(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index cleaner_time_off_idx on cleaner_time_off using gist (cleaner_id, tstzrange(starts_at, ends_at));

create table blocked_periods (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index blocked_periods_idx on blocked_periods using gist (tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create table recurring_series (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  property_id uuid not null references properties(id) on delete restrict,
  service_slug text not null,
  quote_id uuid references quotes(id) on delete set null,
  frequency text not null check (frequency in ('weekly','biweekly','monthly','quarterly','custom')),
  interval_days integer check (interval_days between 1 and 365),
  anchor_date date not null,
  start_time time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 960),
  price_cents integer not null check (price_cents >= 0),
  cleaner_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  ends_on date,
  generated_through date,
  notes text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequency <> 'custom' or interval_days is not null)
);
create index recurring_series_customer_idx on recurring_series(customer_id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references customers(id) on delete restrict,
  property_id uuid not null references properties(id) on delete restrict,
  service_slug text not null,
  quote_id uuid references quotes(id) on delete set null,
  series_id uuid references recurring_series(id) on delete set null,
  occurrence_date date,                     -- the series slot this row fills (stays fixed when rescheduled)
  is_exception boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled','declined','no_show')),
  source text not null default 'admin' check (source in ('website','admin','recurring','import')),
  frequency text not null default 'one_time',
  agreed_price_cents integer not null default 0 check (agreed_price_cents >= 0),
  estimated_minutes integer not null check (estimated_minutes between 15 and 960),
  actual_minutes integer check (actual_minutes between 0 and 2880),
  addons jsonb not null default '[]',
  checklist jsonb not null default '[]',
  internal_notes text not null default '',
  customer_notes text not null default '',
  access_instructions text not null default '',
  scheduling_preferences text not null default '',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid','not_tracked')),
  needs_attention text,                     -- e.g. recurring conflict flagged for admin review
  manage_token_hash text unique,
  idempotency_key text unique,
  cancelled_reason text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (series_id, occurrence_date)
);
create index appointments_time_idx on appointments using gist (tstzrange(starts_at, ends_at));
create index appointments_starts_idx on appointments(starts_at);
create index appointments_status_idx on appointments(status, starts_at);
create index appointments_customer_idx on appointments(customer_id, starts_at desc);

-- One row per cleaner on a job. `during` mirrors the appointment window and `active` mirrors
-- whether that appointment still occupies time; the exclusion constraint makes it impossible
-- for two concurrent transactions to double-book the same cleaner.
create table appointment_assignments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  cleaner_id uuid not null references cleaners(id) on delete restrict,
  during tstzrange not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (appointment_id, cleaner_id),
  constraint no_cleaner_double_booking exclude using gist (cleaner_id with =, during with &&) where (active)
);
create index assignments_cleaner_idx on appointment_assignments(cleaner_id);

create or replace function sync_assignment_window() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'appointments' then
    update appointment_assignments
       set during = tstzrange(new.starts_at, new.ends_at),
           active = new.status in ('pending','confirmed','completed')
     where appointment_id = new.id;
    return new;
  else
    select tstzrange(a.starts_at, a.ends_at), a.status in ('pending','confirmed','completed')
      into new.during, new.active
      from appointments a where a.id = new.appointment_id;
    return new;
  end if;
end $$;

create trigger appointments_sync_assignments
  after update of starts_at, ends_at, status on appointments
  for each row execute function sync_assignment_window();
create trigger assignments_fill_window
  before insert or update on appointment_assignments
  for each row execute function sync_assignment_window();

create table appointment_changes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind text not null,                      -- created, status, reschedule, assign, price, note, customer_request
  from_value jsonb,
  to_value jsonb,
  note text not null default '',
  actor_profile_id uuid references profiles(id) on delete set null,
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index appointment_changes_idx on appointment_changes(appointment_id, created_at);

create table customer_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind text not null check (kind in ('cancel','reschedule')),
  requested_starts_at timestamptz,
  message text not null default '',
  status text not null default 'open' check (status in ('open','approved','denied','withdrawn')),
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_requests_open_idx on customer_requests(status, created_at);

-- ---------------------------------------------------------------------------
-- Jobs and money
-- ---------------------------------------------------------------------------
create table job_records (
  appointment_id uuid primary key references appointments(id) on delete cascade,
  completed_at timestamptz not null default now(),
  revenue_cents integer not null check (revenue_cents >= 0),
  supplies_cents integer not null default 0 check (supplies_cents >= 0),
  other_cost_cents integer not null default 0 check (other_cost_cents >= 0),
  checklist_done jsonb not null default '[]',
  notes text not null default '',
  recorded_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table labor_records (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  cleaner_id uuid not null references cleaners(id) on delete restrict,
  clock_in timestamptz,
  clock_out timestamptz,
  minutes integer not null check (minutes between 0 and 2880),
  pay_cents integer not null check (pay_cents >= 0),   -- computed from the cleaner's pay settings when recorded
  pay_basis text not null,                                -- e.g. "hourly $22.00 × 3.0 h"
  created_at timestamptz not null default now(),
  unique (appointment_id, cleaner_id),
  check (clock_out is null or clock_in is null or clock_out > clock_in)
);
create index labor_cleaner_idx on labor_records(cleaner_id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null check (category in ('supplies','mileage','software','equipment','marketing','insurance','labor_other','other')),
  amount_cents integer not null check (amount_cents > 0),
  description text not null default '',
  appointment_id uuid references appointments(id) on delete set null,
  is_estimate boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index expenses_date_idx on expenses(spent_on);

create table payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete set null,
  customer_id uuid not null references customers(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('cash','card','zelle','venmo','check','stripe','other')),
  received_at timestamptz not null default now(),
  provider_ref text,
  notes text not null default '',
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_customer_idx on payments(customer_id);

-- ---------------------------------------------------------------------------
-- Communications, content, audit, abuse protection, imports
-- ---------------------------------------------------------------------------
create table communications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  quote_id uuid references quotes(id) on delete set null,
  channel text not null check (channel in ('email','sms')),
  template text not null,
  recipient text not null,
  subject text not null default '',
  body_text text not null default '',
  status text not null check (status in ('queued','sent','failed','skipped')),
  provider text,
  provider_message_id text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index communications_customer_idx on communications(customer_id, created_at desc);
create index communications_appt_idx on communications(appointment_id);
create index communications_status_idx on communications(status);

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  message text not null,
  status text not null default 'new' check (status in ('new','handled','spam')),
  created_at timestamptz not null default now()
);

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  body text not null,
  context text not null default '',          -- e.g. "Biweekly client, Summerlin"
  permission_confirmed boolean not null default false,
  published boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  check (not published or permission_confirmed)
);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references profiles(id) on delete set null,
  actor_label text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity_type, entity_id, created_at desc);

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  status text not null default 'review' check (status in ('review','committed','discarded')),
  mapping jsonb not null default '{}',
  rows jsonb not null default '[]',
  summary jsonb not null default '{}',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','services','addons','customers','properties','quotes','cleaners',
                           'recurring_series','appointments','job_records'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The Next.js server talks to Postgres with a server-only connection string (table owner).
-- RLS is enabled on every table so the public anon key can never read business data,
-- and signed-in Supabase users only see rows their role allows.
-- ---------------------------------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.app_cleaner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select cleaner_id from profiles where auth_user_id = auth.uid() and active and role = 'cleaner' limit 1
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','sessions','settings','service_areas','services','addons','pricing_versions',
    'customers','properties','quotes','quote_line_items','cleaners','cleaner_working_hours','cleaner_time_off',
    'blocked_periods','recurring_series','appointments','appointment_assignments','appointment_changes',
    'customer_requests','job_records','labor_records','expenses','payments','communications',
    'contact_messages','testimonials','audit_logs','rate_limits','import_batches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    -- owners and admins: full access
    execute format($p$create policy %I on %I for all to authenticated
                     using (public.app_role() in ('owner','admin'))
                     with check (public.app_role() in ('owner','admin'))$p$, t || '_admin_all', t);
  end loop;

  -- office staff: scheduling + CRM, but not finance, pay, pricing internals, staff or audit
  foreach t in array array['service_areas','services','addons','customers','properties','quotes','quote_line_items',
    'blocked_periods','recurring_series','appointments','appointment_assignments','appointment_changes',
    'customer_requests','communications','contact_messages','cleaner_working_hours','cleaner_time_off'] loop
    execute format($p$create policy %I on %I for all to authenticated
                     using (public.app_role() = 'office')
                     with check (public.app_role() = 'office')$p$, t || '_office_all', t);
  end loop;
end $$;

-- cleaners: only their own assignments and the appointments behind them
create policy appointment_assignments_cleaner_read on appointment_assignments for select to authenticated
  using (public.app_role() = 'cleaner' and cleaner_id = public.app_cleaner_id());
create policy appointments_cleaner_read on appointments for select to authenticated
  using (public.app_role() = 'cleaner' and exists (
    select 1 from appointment_assignments aa where aa.appointment_id = appointments.id and aa.cleaner_id = public.app_cleaner_id()));
create policy profiles_self_read on profiles for select to authenticated using (auth_user_id = auth.uid());
