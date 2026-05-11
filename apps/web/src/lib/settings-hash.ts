/**
 * Color-impacting admin settings hash (P4-E2 / R4-L3 / FA-L1).
 *
 * Computes a stable 8-character SHA-256 prefix over the settings that
 * change the encoded bytes of the served derivatives:
 *
 *   - `wide_gamut_jpeg_chroma` (4:4:4 / 4:2:0 chroma subsampling)
 *   - `avif_effort` (encoder effort 0-9)
 *   - `force_srgb_derivatives` (gamut-collapse override)
 *
 * The hash is folded into the ETag formula in `serve-upload.ts` so a
 * change to any of those settings forces a `must-revalidate` 304 →
 * 200 cycle on every cached client even when the file's mtime has not
 * changed. Without this, an admin who flips
 * `force_srgb_derivatives=true` to clean up a colorimetric bug ships
 * the new pipeline only to fresh browsers; the existing cached
 * responses keep the old bytes for `Cache-Control max-age=86400`.
 *
 * SSR / cold-start safety: the function always synchronously returns
 * 8 hex characters. The DB read is debounced behind a 5-second cache
 * so a misbehaving DB does not stall image responses.
 */

import { createHash } from 'node:crypto';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { inArray } from 'drizzle-orm';

const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
] as const;

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

async function fetchHashFromDb(): Promise<string> {
    try {
        const rows = await db
            .select({ key: adminSettings.key, value: adminSettings.value })
            .from(adminSettings)
            .where(inArray(adminSettings.key, [...COLOR_IMPACTING_KEYS]));
        const map: Record<string, string> = {};
        for (const r of rows) map[r.key] = r.value;
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
 * The cache holds for 5 seconds so a flood of image requests does not
 * issue one DB SELECT per file. A multi-process deployment will see
 * brief skew until each process refreshes — acceptable because every
 * browser will revalidate within the next 5 s window.
 */
export async function getColorSettingsHash(): Promise<string> {
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
