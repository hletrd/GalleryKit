/**
 * R16C16 A16-01: privacy field-split guard for the PUBLIC search routes.
 *
 * `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts` are
 * anonymous, per-IP-rate-limited PUBLIC routes that hand-pick `images` columns
 * inline for result-card enrichment. Unlike `publicSelectFields` / `searchFields`
 * (which carry an `Extract<…, PrivacySensitiveKeys>` compile guard in data.ts),
 * these inline selects have NO tsc/test signal: a future `latitude: images.latitude`
 * added for a "show location" feature would leak GPS to anonymous users silently.
 *
 * This fixture scans both route sources for any reference to a privacy-sensitive
 * `images.<col>` column. Today both select only public fields (id/title/
 * description/filename_jpeg/width/height/topic/camera_model/lens_model/
 * capture_date) so the scan passes; it fails the moment a PII column is wired in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminSelectFieldKeys, publicSelectFieldKeys } from '@/lib/data';

// R18C18 A2 / MAJOR-3: DERIVE the denylist from the canonical privacy split
// instead of hand-maintaining a frozen mirror of `PrivacySensitiveKeys`.
//
// The admin-only column set is exactly `adminSelectFieldKeys \ publicSelectFieldKeys`
// (the same derivation `privacy-fields.test.ts` symmetric-guards). Computing it
// here means a NEW admin-only column added to `adminSelectFields` becomes a
// denied column in this scan AUTOMATICALLY — closing the drift-vector-1 gap
// where the previously-frozen 19-entry array would silently miss a 21st PII
// column. `processed` is EXCLUDED: it is the public-query status filter
// (`eq(images.processed, true)`), not a PII projection, and legitimately
// appears in these routes' WHERE clauses.
const publicKeySet = new Set<string>(publicSelectFieldKeys);
const PII_COLUMNS = [...adminSelectFieldKeys].filter(
    (key) => !publicKeySet.has(key) && key !== 'processed',
);

const ROUTES: ReadonlyArray<readonly [name: string, relPath: string]> = [
    ['search/semantic', '../app/api/search/semantic/route.ts'],
    ['search/similar', '../app/api/search/similar/[id]/route.ts'],
];

describe('public search routes do not reference PII image columns (R16C16 A16-01)', () => {
    it('derived PII_COLUMNS denylist is non-vacuous and tracks the privacy split (R18C18 A2)', () => {
        // Guard against the derivation silently collapsing to [] (which would make
        // the per-route scan vacuous). The known core PII columns must be present.
        expect(PII_COLUMNS.length).toBeGreaterThanOrEqual(15);
        for (const core of ['latitude', 'longitude', 'filename_original', 'user_filename', 'uploaded_by']) {
            expect(PII_COLUMNS).toContain(core);
        }
        // `processed` is the public status filter — it must NOT be in the denylist.
        expect(PII_COLUMNS).not.toContain('processed');
    });

    it.each(ROUTES)('%s route selects no privacy-sensitive images column', (_name, relPath) => {
        const src = readFileSync(resolve(__dirname, relPath), 'utf8');
        const leaked = PII_COLUMNS.filter((col) =>
            new RegExp(`images\\.${col}\\b`).test(src),
        );
        expect(
            leaked,
            `Public search route must not reference PII image column(s): ${leaked.join(', ')}. ` +
            `These routes are anonymous; selecting a privacy-sensitive column leaks it to the public.`,
        ).toEqual([]);
    });
});
