-- Penalties are attached directly to submitted files.
create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  file_update_id uuid not null references public.file_updates(id) on delete cascade,
  reason text not null,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now()
);

create index if not exists penalties_player_id_idx on public.penalties(player_id);
create unique index if not exists penalties_file_unique on public.penalties(file_update_id);
alter table public.penalties enable row level security;

drop policy if exists penalties_player_select on public.penalties;
create policy penalties_player_select on public.penalties for select to authenticated using ((select auth.uid()) = player_id);
drop policy if exists penalties_admin_select on public.penalties;
create policy penalties_admin_select on public.penalties for select to authenticated using ((select private.is_admin()));
drop policy if exists penalties_admin_insert on public.penalties;
create policy penalties_admin_insert on public.penalties for insert to authenticated with check ((select private.is_admin()));
drop policy if exists penalties_admin_delete on public.penalties;
create policy penalties_admin_delete on public.penalties for delete to authenticated using ((select private.is_admin()));

alter table public.player_hours add column if not exists assigned_at timestamptz not null default now();
create index if not exists player_hours_assigned_at_idx on public.player_hours (assigned_at);

create table if not exists public.app_settings (
  key text primary key,
  value_boolean boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
insert into public.app_settings (key, value_boolean) values ('auto_penalty_enabled', false) on conflict (key) do nothing;

-- Players can see penalized files, but cannot edit/delete them.
drop policy if exists file_updates_player_update on public.file_updates;
create policy file_updates_player_update on public.file_updates for update to authenticated
using ((select auth.uid()) = player_id and is_flagged = false and not exists (select 1 from public.penalties p where p.file_update_id = file_updates.id))
with check ((select auth.uid()) = player_id and is_flagged = false and not exists (select 1 from public.penalties p where p.file_update_id = file_updates.id));
drop policy if exists file_updates_player_delete on public.file_updates;
create policy file_updates_player_delete on public.file_updates for delete to authenticated
using ((select auth.uid()) = player_id and is_flagged = false and not exists (select 1 from public.penalties p where p.file_update_id = file_updates.id));

notify pgrst, 'reload schema';
