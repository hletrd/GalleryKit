-- Migration 0023: remove Stripe paid-downloads (US-P54) entirely.
--
-- GalleryKit is a free, open-source self-hosted gallery; the paid-download
-- feature is removed from code + database. Verified zero data loss before
-- shipping: the `entitlements` table had 0 rows and every `images` row had
-- `license_tier = 'none'` (the feature was never used in production).
--
-- Drizzle records each migration's hash in __drizzle_migrations and runs it
-- exactly once, so bare DDL (matching the repo convention — e.g. 0019's bare
-- ADD COLUMN) is safe here; MySQL 8.0 does NOT support `DROP COLUMN IF EXISTS`
-- (that is a MariaDB extension), so the column drop is unguarded. On both a
-- fresh DB and an incremental prod DB, migrations 0008 (adds license_tier) and
-- 0013 (creates entitlements) run/baseline before this one, so the targets
-- always exist when this runs via drizzle.migrate(). The legacy-reconcile path
-- never runs this file — reconcileLegacySchema is updated to no longer create
-- entitlements / license_tier, so a baselined legacy DB matches this state.
DROP TABLE IF EXISTS `entitlements`;
--> statement-breakpoint
ALTER TABLE `images` DROP COLUMN `license_tier`;
