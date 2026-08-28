drop policy if exists profiles_select_authenticated
on public.profiles;

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (
  (select private.is_admin())
  or id = (select auth.uid())
);

drop policy if exists profiles_update_own
on public.profiles;

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));