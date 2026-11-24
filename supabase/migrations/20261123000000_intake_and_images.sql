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
