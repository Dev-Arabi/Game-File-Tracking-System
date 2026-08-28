drop policy if exists file_updates_select_own
on public.file_updates;

create policy file_updates_select_own
on public.file_updates
for select
to authenticated
using (
  player_id = (select auth.uid())
  or (select private.is_admin())
);

drop policy if exists file_updates_insert_own
on public.file_updates;

create policy file_updates_insert_own
on public.file_updates
for insert
to authenticated
with check (
  player_id = (select auth.uid())
);