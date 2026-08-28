-- Add optional tiers to player assignments.
-- Existing assignments remain valid with a NULL tier until an admin updates them.

alter table public.player_hours
  add column if not exists tier text;

alter table public.player_hours
  drop constraint if exists player_hours_tier_check;

alter table public.player_hours
  add constraint player_hours_tier_check
  check (tier is null or tier in ('Tier 1', 'Tier 2', 'Tier 3'));

comment on column public.player_hours.tier is 'Optional assignment tier selected by an admin: Tier 1, Tier 2, or Tier 3.';

notify pgrst, 'reload schema';
