-- Player game assignment support
-- Apply this SQL in Supabase before using the player workspace.

create index if not exists player_hours_player_game_idx
  on public.player_hours (player_id, game_id);

create index if not exists player_hours_game_idx
  on public.player_hours (game_id);

alter table public.player_hours enable row level security;

-- Players can only read assignments belonging to their own account.
drop policy if exists "Players can view their own game assignments" on public.player_hours;
create policy "Players can view their own game assignments"
  on public.player_hours
  for select
  to authenticated
  using ((select auth.uid()) = player_id);

-- Admin access remains controlled by the existing admin policies. If those policies
-- do not exist in your project, add an admin-only SELECT policy using your existing
-- public.is_admin() helper rather than exposing every assignment.

-- The player UI queries assigned games through this relationship:
-- player_hours -> games, filtered by player_id. The games foreign key already
-- guarantees that deleted games disappear from the player's available choices.

notify pgrst, 'reload schema';
