/**
 * AGG-C5-T1 (run-9 c2 TE-5) — full en.json <-> ko.json leaf-key parity gate.
 *
 * The "837 = 837, 0 drift" parity figure quoted across review cycles was an
 * orchestrator-side MANUAL count, not a committed regression gate. The existing
 * i18n tests (humanize-transfer-function-i18n, color-pipeline-decision-i18n, the
 * cycle source-contract files) pin only SPECIFIC newly-added keys in both
 * locales — they catch intentionally-ADDED keys but NOT accidentally-DROPPED
 * ones. So a refactor that drops a pre-existing key from one locale (e.g. during
 * a nested-namespace rename) makes next-intl render the raw key string verbatim
 * to that locale's users, with no test failing.
 *
 * This file is that missing gate: it flattens BOTH message objects to their
 * leaf-key sets and asserts SET EQUALITY.
 *
 * CRITICAL — KEYS ONLY, never values. Per CLAUDE.md DOC-R5C3-07 the en side uses
 * ICU `plural` blocks (`{count, plural, one {# photo} other {# photos}}`) and the
 * ko side uses a single fixed form (`{count}장`, Korean has no grammatical
 * plural), so the VALUE shapes legitimately differ by language. A key-set
 * equality is exactly the right gate; a value comparison would be wrong.
 */

import { describe, it, expect } from 'vitest';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

function flattenKeys(messages: unknown, prefix = ''): string[] {
    const keys: string[] = [];
    if (messages && typeof messages === 'object') {
        for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object') {
                keys.push(...flattenKeys(value, fullKey));
            } else {
                // Leaf (string or any non-object scalar) — a translatable entry.
                keys.push(fullKey);
            }
        }
    }
    return keys;
}

describe('i18n leaf-key parity (en.json <-> ko.json)', () => {
    const enKeys = flattenKeys(enMessages).sort();
    const koKeys = flattenKeys(koMessages).sort();

    it('en and ko have IDENTICAL leaf-key sets (keys only, not values — DOC-R5C3-07)', () => {
        const enSet = new Set(enKeys);
        const koSet = new Set(koKeys);
        const missingInKo = enKeys.filter((k) => !koSet.has(k));
        const missingInEn = koKeys.filter((k) => !enSet.has(k));

        // Surface the exact drift in the failure message so a dropped/added key
        // is immediately actionable.
        expect(
            missingInKo,
            `Keys present in en.json but MISSING from ko.json (would render the raw key to KO users): ${JSON.stringify(missingInKo)}`,
        ).toEqual([]);
        expect(
            missingInEn,
            `Keys present in ko.json but MISSING from en.json (would render the raw key to EN users): ${JSON.stringify(missingInEn)}`,
        ).toEqual([]);

        // Belt-and-braces: the sorted key arrays are identical.
        expect(koKeys).toEqual(enKeys);
    });

    it('neither locale has duplicate leaf keys (well-formed JSON sanity)', () => {
        expect(new Set(enKeys).size, 'en.json has duplicate flattened keys').toBe(enKeys.length);
        expect(new Set(koKeys).size, 'ko.json has duplicate flattened keys').toBe(koKeys.length);
    });
});
