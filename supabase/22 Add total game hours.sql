-- Add total tracking hours to existing games.
-- Safe to run once against an existing Supabase project.
alter table public.games
  add column if not exists total_hours numeric(10, 2) not null default 0;

alter table public.games
  drop constraint if exists games_total_hours_check;

alter table public.games
  add constraint games_total_hours_check check (total_hours >= 0);

notify pgrst, 'reload schema';
