-- Preserve the tier for every uploaded player file
ALTER TABLE public.file_updates
ADD COLUMN IF NOT EXISTS tier text;

-- Validate future file records
ALTER TABLE public.file_updates
DROP CONSTRAINT IF EXISTS file_updates_tier_check;

ALTER TABLE public.file_updates
ADD CONSTRAINT file_updates_tier_check
CHECK (
  tier IS NULL
  OR tier IN ('Tier 1', 'Tier 2', 'Tier 3')
);

-- Improve filtering by player, game, and tier
CREATE INDEX IF NOT EXISTS file_updates_player_game_tier_idx
ON public.file_updates (player_id, game_id, tier);

NOTIFY pgrst, 'reload schema';