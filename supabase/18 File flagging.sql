-- File flagging
-- Adds a persistent moderation flag to file_updates.
-- Run after the existing file_updates table and RLS policies.

alter table public.file_updates
  add column if not exists is_flagged boolean not null default false;

create index if not exists file_updates_is_flagged_idx
  on public.file_updates (is_flagged)
  where is_flagged = true;

-- Admins may flag or unflag any file they can already read.
-- Players retain their existing read/insert/update policies and cannot change this column.
drop policy if exists file_updates_admin_flag on public.file_updates;
create policy file_updates_admin_flag
on public.file_updates
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- Refresh PostgREST's schema cache after applying the change.
notify pgrst, 'reload schema';
