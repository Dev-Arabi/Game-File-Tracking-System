-- Allow an admin to remove a game together with its dependent records.
-- Run this migration in the Supabase SQL editor or migration workflow.

alter table public.file_updates
  drop constraint if exists file_updates_game_id_fkey;

alter table public.file_updates
  add constraint file_updates_game_id_fkey
  foreign key (game_id)
  references public.games(id)
  on delete cascade;

-- Keep this explicit policy idempotent for projects that use split policies.
drop policy if exists games_delete_admin on public.games;
create policy games_delete_admin
on public.games
for delete
to authenticated
using ((select private.is_admin()));

-- Verify the active foreign-key behavior.
select
  constraint_name,
  delete_rule
from information_schema.referential_constraints
where constraint_name = 'file_updates_game_id_fkey';
