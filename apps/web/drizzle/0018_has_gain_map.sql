-- P4-A1 / R4-H1: Apple HDR gain map detection.
--
-- Stores whether an uploaded HEIF / AVIF carries an Apple-style HDR gain map
-- auxiliary item. Detected at upload time via lib/gain-map-detection.ts.
--
-- Admin-only field — surfaced in the Color Details audit panel so the admin
-- can honestly tell the photographer when the source carries an HDR layer
-- that the SDR-only delivery pipeline is not yet passing through (WI-09).
--
-- Privacy: NOT in the public projection (publicSelectFields excludes this
-- column). Listed in `_PrivacySensitiveKeys` for compile-time enforcement.

ALTER TABLE `images`
    ADD COLUMN `has_gain_map` BOOLEAN NOT NULL DEFAULT FALSE AFTER `is_hdr`;
