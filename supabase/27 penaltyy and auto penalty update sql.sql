-- Penalties linked directly to submitted files, like file flagging.
-- Run after the base schema has created public.profiles and public.file_updates.

create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  file_update_id uuid not null references public.file_updates(id) on delete cascade,
  reason text not null default 'Manual penalty',
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now()
);

-- Upgrade an earlier version of this table that used assignment_id.
delete from public.penalties where file_update_id is null;
alter table public.penalties drop column if exists assignment_id;
alter table public.penalties alter column file_update_id set not null;

create index if not exists penalties_player_id_idx
  on public.penalties(player_id);
create index if not exists penalties_file_update_id_idx
  on public.penalties(file_update_id);
create unique index if not exists penalties_auto_file_unique
  on public.penalties(file_update_id)
  where source = 'auto';

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

notify pgrst, 'reload schema';
