create index if not exists idx_games_created_at
on public.games (created_at desc);

create index if not exists idx_player_hours_player_game_created
on public.player_hours (player_id, game_id, created_at desc);

create index if not exists idx_player_hours_game_created
on public.player_hours (game_id, created_at desc);

create index if not exists idx_file_updates_player_created
on public.file_updates (player_id, created_at desc);

create index if not exists idx_file_updates_game_created
on public.file_updates (game_id, created_at desc);