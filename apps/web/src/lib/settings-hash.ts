/**
 * Color-impacting admin settings hash (P4-E2 / R4-L3 / FA-L1).
 *
 * Computes a stable 8-character SHA-256 prefix over the 9 settings that
 * change the encoded bytes of the served derivatives (see
 * `COLOR_IMPACTING_KEYS` below — the authoritative list; AGG-R7-08
 * corrected this docstring from a stale 3-key summary):
 *
 *   - color: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`,
 *     `force_srgb_derivatives`, `wide_gamut_max_source_pixels`
 *   - quality: `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`
 *   - size: `image_sizes`
 *
 * The hash is folded into the route-handler ETag formula in `serve-upload.ts`
 * so a change to any of those settings forces a `must-revalidate` 304 → 200
 * cycle on clients that hit that fallback path even when the file's mtime has
 * not changed. Existing files normally resolve through Next's static server,
 * so settings-only changes still need a re-encode before static derivatives
 * change bytes. Without this fallback-path hash, an admin who flips
 * `force_srgb_derivatives=true` to clean up a colorimetric bug ships
 * the new pipeline only to fresh browsers on the route-handler path; the existing cached
 * responses keep the old bytes for `Cache-Control max-age=3600,
 * must-revalidate` (AGG-C3-05: was a stale `max-age=86400` here; R8-R7
 * reduced the served value to 3600 across serve-upload.ts, next.config.ts,
 * and nginx/default.conf — the 86400 surfaces are s-maxage / SWR on the OG
 * routes only).
 *
 * SSR / cold-start safety: the function always resolves to 8 hex
 * characters. The NO-ARG form debounces its DB read behind a 5-second
 * cache; the config-arg form (R8-H1) computes purely from the caller's
 * resolved GalleryConfig and performs no DB read here — but the CALLER
 * pays whatever it cost to resolve that config, so hot paths must
 * debounce the config resolution themselves (R4C3 PERF-R4C3-05:
 * `serve-upload.ts` does, via its module-scoped 5 s TTL cache).
 */

import { createHash } from 'node:crypto';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { inArray } from 'drizzle-orm';
import type { GalleryConfig } from './gallery-config';
import { DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS, parseImageSizes, type GallerySettingKey } from './gallery-config-shared';

// R16C16 TE-16-04: exported so a unit test can pin the exhaustive membership
// (the compile-time guard below only validates each entry IS a setting key, not
// that the list is complete — see the NOTE on _ColorKeysAreSettingKeys).
export const COLOR_IMPACTING_KEYS = DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS;

// AGG-R7C3-02: compile-time guard — every COLOR_IMPACTING_KEY MUST be a real
// gallery setting key. Mirrors the PrivacySensitiveKeys-derived guards in
// data.ts: a typo or a key removed from GALLERY_SETTING_KEYS becomes a hard
// `tsc` error here instead of a silent ETag-invalidation desync. NOTE: this
// canNOT catch a *forgotten new* byte-impacting setting (a valid key is still a
// valid key) — that gap is closed by the CLAUDE.md "Adding a new color-impacting
// setting" checklist, not by the type system.
type _ColorKeysAreSettingKeys =
    (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never;
const _colorKeysAreSettingKeys: _ColorKeysAreSettingKeys = true;
void _colorKeysAreSettingKeys;

const HASH_LENGTH = 8;
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
    hash: string;
    fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<string> | null = null;

function buildHash(values: Record<string, string | undefined>): string {
    const ordered = COLOR_IMPACTING_KEYS.map((k) => `${k}=${values[k] ?? ''}`).join('|');
    return createHash('sha256').update(ordered, 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

const FALLBACK_HASH = buildHash({});

// R8-H1: build hash from resolved GalleryConfig values instead of raw DB strings.
// This prevents ETag misalignment when invalid DB values are stored (e.g.
// image_quality_avif=150) but the encoder falls back to defaults.
function buildHashFromConfig(config: GalleryConfig): string {
    const values: Record<string, string> = {
        wide_gamut_jpeg_chroma: config.wideGamutJpegChroma,
        sdr_jpeg_chroma: config.sdrJpegChroma,
        avif_effort: String(config.avifEffort),
        force_srgb_derivatives: String(config.forceSrgbDerivatives),
        wide_gamut_max_source_pixels: String(config.wideGamutMaxSourcePixels),
        image_quality_webp: String(config.imageQualityWebp),
        image_quality_avif: String(config.imageQualityAvif),
        image_quality_jpeg: String(config.imageQualityJpeg),
        image_sizes: [...config.imageSizes].sort((a, b) => a - b).join(','),
    };
    return buildHash(values);
}

async function fetchHashFromDb(): Promise<string> {
    try {
        const rows = await db
            .select({ key: adminSettings.key, value: adminSettings.value })
            .from(adminSettings)
            .where(inArray(adminSettings.key, [...COLOR_IMPACTING_KEYS]));
        const map: Record<string, string> = {};
        for (const r of rows) map[r.key] = r.value;
        // C4-19 (run-10 c4): normalize a stored image_sizes value to the SAME
        // sorted CSV the config-arg path hashes (buildHashFromConfig sorts
        // ascending). The admin UI persists the array in display order, so a
        // stored "1536,640" would otherwise hash differently on this no-arg DB
        // path than on the resolved-config path — flipping the ETag (spurious
        // 304 → 200) whenever serve-upload briefly falls back to this form.
        // parseImageSizes sorts + de-dupes and coerces empty/invalid input to
        // DEFAULT_IMAGE_SIZES, exactly matching the config-arg resolution.
        if (map.image_sizes !== undefined) {
            map.image_sizes = parseImageSizes(map.image_sizes).join(',');
        }
        return buildHash(map);
    } catch {
        // DB not reachable / settings table missing — fall back to a
        // stable hash over empty inputs. Subsequent ticks will retry.
        return FALLBACK_HASH;
    }
}

/**
 * Return the 8-character color-settings hash for use in ETag formulas.
 *
 * The function is safe to call from any request handler — it never
 * throws and the worst case is the FALLBACK_HASH (which still changes
 * if any setting changes from empty to non-empty).
 *
 * NO-ARG form: the internal cache holds for 5 seconds so a flood of
 * callers does not issue one DB SELECT each. A multi-process deployment
 * will see brief skew until each process refreshes — acceptable because
 * every browser will revalidate within the next 5 s window.
 *
 * CONFIG-ARG form (R8-H1): bypasses the internal cache entirely — it is
 * a pure computation over the caller-resolved GalleryConfig. Callers on
 * request-flood paths must debounce their own config resolution (see
 * serve-upload.ts `getServingColorSettingsHash`, R4C3 PERF-R4C3-05).
 */
export async function getColorSettingsHash(config?: GalleryConfig): Promise<string> {
    // R8-H1: when a resolved GalleryConfig is provided, compute the hash
    // directly from validated values instead of reading raw DB strings.
    if (config) {
        return buildHashFromConfig(config);
    }

    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.hash;
    }
    if (inflight) {
        return inflight;
    }
    inflight = fetchHashFromDb()
        .then((hash) => {
            cache = { hash, fetchedAt: Date.now() };
            return hash;
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

/**
 * Test-only helper: reset the cache so a unit test can observe a
 * fresh fetch on the next call.
 */
export function _resetSettingsHashCacheForTesting(): void {
    cache = null;
    inflight = null;
}

/**
 * Test-only helper: build the deterministic hash from a map of values.
 * Used by `__tests__/settings-hash.test.ts` to lock the hash formula.
 */
export function _buildHashForTesting(values: Record<string, string | undefined>): string {
    return buildHash(values);
}
