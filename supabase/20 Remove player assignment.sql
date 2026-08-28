-- Allow administrators to remove player game assignments.
-- Apply this migration after the player_hours table and profiles role column exist.

alter table public.player_hours enable row level security;

drop policy if exists "Admins can delete player assignments" on public.player_hours;

create policy "Admins can delete player assignments"
on public.player_hours
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'admin'
  )
); 
