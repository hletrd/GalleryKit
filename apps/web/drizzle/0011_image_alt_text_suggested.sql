-- Migration 0011: alt_text_suggested column for US-P52 (Auto alt-text via local Florence-2)
-- PUBLIC field: used as <img alt> fallback when image.title is empty (SEO + a11y).
-- Admin-set alt (title/description) always takes precedence; this column is never auto-applied.
ALTER TABLE `images` ADD COLUMN `alt_text_suggested` text;
