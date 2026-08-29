-- Allow the three roles
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'player', 'pending'));

alter table public.profiles
  alter column role set default 'pending';

-- New users become Pending
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Player'),
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Allow admins to change roles
create or replace function public.set_profile_role(
  target_profile_id uuid,
  next_role text
)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if not exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  ) then
    raise exception 'Only administrators can change roles';
  end if;

  if next_role not in ('admin', 'player', 'pending') then
    raise exception 'Invalid role';
  end if;

  update public.profiles
  set role = next_role
  where id = target_profile_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Profile not found';
  end if;

  return updated_profile;
end;
$$;

grant execute on function public.set_profile_role(uuid, text)
to authenticated;

notify pgrst, 'reload schema';