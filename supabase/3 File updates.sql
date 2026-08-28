create table if not exists public.file_updates (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  file_name text not null
    check (char_length(trim(file_name)) between 1 and 255),
  duration text not null
    check (char_length(trim(duration)) between 1 and 80),
  upload_status text not null
    check (upload_status in ('Not started', 'In progress', 'Uploaded')),
  created_at timestamptz not null default now()
);