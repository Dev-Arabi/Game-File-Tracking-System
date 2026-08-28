drop policy if exists player_hours_select_admin
on public.player_hours;

create policy player_hours_select_admin
on public.player_hours
for select
to authenticated
using (
  (select private.is_admin())
  or player_id = (select auth.uid())
);

drop policy if exists player_hours_insert_admin
on public.player_hours;

create policy player_hours_insert_admin
on public.player_hours
for insert
to authenticated
with check (
  (select private.is_admin())
  and created_by = (select auth.uid())
);