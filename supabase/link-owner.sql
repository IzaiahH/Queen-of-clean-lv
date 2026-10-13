-- Gives an existing Supabase Auth user owner access to /admin.
-- 1. Supabase → Authentication → Users → Add user → Create new user (tick "Auto Confirm User").
-- 2. Replace the two values below, paste into SQL Editor → New query, and click Run.
insert into profiles (email, full_name, role, auth_user_id, active)
select email, 'Owner Name', 'owner', id, true
  from auth.users
 where lower(email) = lower('owner@example.com')
on conflict ((lower(email))) do update set role = 'owner', auth_user_id = excluded.auth_user_id, active = true;
-- Should say "INSERT 0 1". "INSERT 0 0" means no Auth user has that email yet.
