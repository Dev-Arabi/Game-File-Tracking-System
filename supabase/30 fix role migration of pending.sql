drop function if exists public.set_profile_role(uuid, text);

create function public.set_profile_role(
  target_profile_id uuid,
  next_role text
)
returns jsonb
language plpgsql
security definer
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

  -- Admin accounts cannot be demoted
  if exists (
    select 1
    from public.profiles
    where id = target_profile_id
      and role = 'admin'
  ) then
    raise exception 'Admin accounts cannot be demoted';
  end if;

  update public.profiles
  set role = next_role
  where id = target_profile_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Profile not found';
  end if;

  return jsonb_build_object(
    'id', updated_profile.id,
    'display_name', updated_profile.display_name,
    'role', updated_profile.role
  );
end;
$$;

revoke execute on function public.set_profile_role(uuid, text) from public;

grant execute on function public.set_profile_role(uuid, text)
to authenticated;

notify pgrst, 'reload schema';