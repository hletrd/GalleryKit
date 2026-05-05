-- Migration 0014: Drop reaction artifacts
-- Frontend reactions feature was removed in Cycle 4 (commit series ending at cycle-4-fixes).
-- This migration cleans up the orphaned DB columns and table.

DROP TABLE IF EXISTS image_reactions;
ALTER TABLE images DROP COLUMN IF EXISTS reaction_count;
