drop policy if exists games_select_authenticated
on public.games;

create policy games_select_authenticated
on public.games
for select
to authenticated
using (true);

drop policy if exists games_insert_admin
on public.games;

create policy games_insert_admin
on public.games
for insert
to authenticated
with check (
  (select private.is_admin())
  and created_by = (select auth.uid())
);