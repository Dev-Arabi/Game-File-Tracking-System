ALTER TABLE public.file_updates
ADD COLUMN IF NOT EXISTS tier text
CHECK (tier IN ('Tier 1', 'Tier 2', 'Tier 3'));