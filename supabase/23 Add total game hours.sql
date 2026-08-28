-- Add total tracking hours to existing games.
-- Safe to run once against an existing Supabase project.
alter table public.games
  add column if not exists total_hours numeric(10, 2) not null default 0;

alter table public.games
  drop constraint if exists games_total_hours_check;

alter table public.games
  add constraint games_total_hours_check check (total_hours >= 0);

-- Ensure the existing table allows admins to update hours even if the original
-- policy was not applied or was created with a different name.
drop policy if exists "games_admin_all" on public.games;
drop policy if exists "games_players_read" on public.games;
drop policy if exists "games_admin_update" on public.games;
drop policy if exists "games_authenticated_read" on public.games;

create policy "games_admin_all" on public.games
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "games_players_read" on public.games
  for select to authenticated
  using (true);

notify pgrst, 'reload schema';
