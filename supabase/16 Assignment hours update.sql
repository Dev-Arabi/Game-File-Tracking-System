-- Assignment hours editing
-- No new tables or columns are required. Run this after the original schema.

alter table if exists public.player_hours enable row level security;

drop policy if exists "hours_admin_update" on public.player_hours;
create policy "hours_admin_update"
on public.player_hours
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- The existing "hours_admin_all" policy already permits admin updates when present.
-- This explicit policy is safe to run repeatedly and documents the required permission.
