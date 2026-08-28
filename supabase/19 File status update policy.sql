-- Player file status updates
-- No new tables or columns are required.
-- Run this after the original file_updates policies if they are missing.

alter table public.file_updates enable row level security;

drop policy if exists "files_player_update_own" on public.file_updates;
create policy "files_player_update_own"
on public.file_updates
for update
to authenticated
using ((select auth.uid()) = player_id and is_flagged = false)
with check ((select auth.uid()) = player_id and is_flagged = false);

-- The existing player SELECT policy is required because PostgreSQL evaluates
-- the target row before UPDATE.
drop policy if exists "files_player_read_own" on public.file_updates;
create policy "files_player_read_own"
on public.file_updates
for select
to authenticated
using ((select auth.uid()) = player_id);

-- Players may delete only their own unflagged files.
drop policy if exists "files_player_delete_own" on public.file_updates;
create policy "files_player_delete_own"
on public.file_updates
for delete
to authenticated
using ((select auth.uid()) = player_id and is_flagged = false); 

notify pgrst, 'reload schema';
