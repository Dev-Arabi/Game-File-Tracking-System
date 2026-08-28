-- Penalties and automatic overdue penalties
-- Run this after the base game-tracking schema has created:
-- public.profiles, public.player_hours, and public.file_updates.

create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid references public.player_hours(id) on delete set null,
  file_update_id uuid references public.file_updates(id) on delete set null,
  reason text not null default 'Manual penalty',
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now()
);

create index if not exists penalties_player_id_idx
  on public.penalties(player_id);
create index if not exists penalties_assignment_id_idx
  on public.penalties(assignment_id);
create unique index if not exists penalties_auto_assignment_unique
  on public.penalties(assignment_id)
  where source = 'auto' and assignment_id is not null;

alter table public.penalties enable row level security;

drop policy if exists penalties_player_select on public.penalties;
create policy penalties_player_select
  on public.penalties for select to authenticated
  using ((select auth.uid()) = player_id);

drop policy if exists penalties_admin_select on public.penalties;
create policy penalties_admin_select
  on public.penalties for select to authenticated
  using ((select private.is_admin()));

drop policy if exists penalties_admin_insert on public.penalties;
create policy penalties_admin_insert
  on public.penalties for insert to authenticated
  with check ((select private.is_admin()));

alter table public.player_hours
  add column if not exists assigned_at timestamptz not null default now();

create index if not exists player_hours_deadline_idx
  on public.player_hours(assigned_at);

create table if not exists public.app_settings (
  key text primary key,
  value_boolean boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all
  on public.app_settings for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

insert into public.app_settings (key, value_boolean)
values ('auto_penalty_enabled', false)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
