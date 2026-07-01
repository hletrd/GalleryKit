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

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

const MESSAGE_SOURCES = [
    { locale: 'en', path: new URL('../../messages/en.json', import.meta.url) },
    { locale: 'ko', path: new URL('../../messages/ko.json', import.meta.url) },
] as const;

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

function skipWhitespace(source: string, index: number) {
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
    return index;
}

function readJsonString(source: string, index: number) {
    const start = index;
    index += 1;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            index += 2;
            continue;
        }
        if (char === '"') {
            const raw = source.slice(start, index + 1);
            return { value: JSON.parse(raw) as string, next: index + 1 };
        }
        index += 1;
    }
    throw new Error('Unterminated JSON string');
}

function skipJsonNumber(source: string, index: number) {
    while (index < source.length && /[-+0-9.eE]/.test(source[index] ?? '')) index += 1;
    return index;
}

function findDuplicateObjectKeys(source: string) {
    const duplicates: string[] = [];

    function parseValue(index: number, path: string): number {
        index = skipWhitespace(source, index);
        const char = source[index];
        if (char === '{') return parseObject(index, path);
        if (char === '[') return parseArray(index, path);
        if (char === '"') return readJsonString(source, index).next;
        if (char === '-' || /\d/.test(char ?? '')) return skipJsonNumber(source, index);
        for (const literal of ['true', 'false', 'null']) {
            if (source.startsWith(literal, index)) return index + literal.length;
        }
        throw new Error(`Unexpected JSON token at offset ${index}`);
    }

    function parseArray(index: number, path: string): number {
        index += 1;
        index = skipWhitespace(source, index);
        if (source[index] === ']') return index + 1;
        while (index < source.length) {
            index = parseValue(index, `${path}[]`);
            index = skipWhitespace(source, index);
            if (source[index] === ']') return index + 1;
            if (source[index] !== ',') throw new Error(`Expected "," or "]" at offset ${index}`);
            index += 1;
        }
        throw new Error('Unterminated JSON array');
    }

    function parseObject(index: number, path: string): number {
        const seen = new Set<string>();
        index += 1;
        index = skipWhitespace(source, index);
        if (source[index] === '}') return index + 1;
        while (index < source.length) {
            if (source[index] !== '"') throw new Error(`Expected object key at offset ${index}`);
            const key = readJsonString(source, index);
            index = skipWhitespace(source, key.next);
            if (source[index] !== ':') throw new Error(`Expected ":" after key at offset ${index}`);
            const fullKey = path ? `${path}.${key.value}` : key.value;
            if (seen.has(key.value)) duplicates.push(fullKey);
            seen.add(key.value);
            index = parseValue(index + 1, fullKey);
            index = skipWhitespace(source, index);
            if (source[index] === '}') return index + 1;
            if (source[index] !== ',') throw new Error(`Expected "," or "}" at offset ${index}`);
            index += 1;
            index = skipWhitespace(source, index);
        }
        throw new Error('Unterminated JSON object');
    }

    const end = skipWhitespace(source, parseValue(0, ''));
    if (end !== source.length) throw new Error(`Unexpected trailing JSON token at offset ${end}`);
    return duplicates;
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

    it('neither locale has duplicate object keys in raw JSON source', () => {
        for (const { locale, path } of MESSAGE_SOURCES) {
            const source = readFileSync(path, 'utf8');
            expect(
                findDuplicateObjectKeys(source),
                `${locale}.json has duplicate object keys; parsed imports would silently keep only the last value`,
            ).toEqual([]);
        }
    });
});
