-- R10-M4: track per-image delivered AVIF bit depth (10-bit vs 8-bit)
ALTER TABLE images ADD COLUMN avif_10bit BOOLEAN;
