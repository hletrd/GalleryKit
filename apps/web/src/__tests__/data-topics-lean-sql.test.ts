import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * WP11 (C2-13/PERF-03, run-10 cycle-2): `getTopics()` (behind `getTopicsCached`,
 * used by nav/home/topic/smart-collection pages — all `revalidate = 0`)
 * previously carried a correlated `MAX(updated_at)` subquery per topic that
 * only the sitemap's `<lastmod>` needed. That subquery now lives exclusively
 * in `getTopicsWithLatestUpdate()`, used only by `sitemap.ts`.
 *
 * Fixture-style source inspection, same technique as
 * `data-tag-names-sql.test.ts`: locks the split so a future refactor can't
 * silently reattach the subquery to the hot lean accessor, or drop it from
 * the sitemap-only one.
 */

const dataPath = path.resolve(__dirname, '..', 'lib', 'data.ts');
const sitemapPath = path.resolve(__dirname, '..', 'app', 'sitemap.ts');

function readSource(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

function extractFunctionBody(source: string, fnName: string): string {
    const startMarker = `export async function ${fnName}(`;
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        throw new Error(`Function not found: ${fnName}`);
    }
    let i = startIdx;
    while (i < source.length && source[i] !== '{') i++;
    if (i >= source.length) {
        throw new Error(`Opening brace not found for: ${fnName}`);
    }
    const openIdx = i;
    let depth = 0;
    for (let j = openIdx; j < source.length; j++) {
        const ch = source[j];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(startIdx, j + 1);
            }
        }
    }
    throw new Error(`Closing brace not found for: ${fnName}`);
}

describe('getTopics / getTopicsWithLatestUpdate split (WP11 / C2-13)', () => {
    it('getTopics has no correlated MAX(updated_at) subquery and does not select last_image_updated_at', () => {
        const source = readSource(dataPath);
        const body = extractFunctionBody(source, 'getTopics');

        expect(body).not.toMatch(/MAX\(/);
        expect(body).not.toMatch(/last_image_updated_at/);
        expect(body).not.toContain('SELECT MAX');
        // Still selects the fields every consumer (nav/home/topic/collection
        // pages, admin dashboard) needs.
        expect(body).toMatch(/slug:\s*topics\.slug/);
        expect(body).toMatch(/label:\s*topics\.label/);
        expect(body).toMatch(/order:\s*topics\.order/);
        expect(body).toMatch(/image_filename:\s*topics\.image_filename/);
        expect(body).toMatch(/map_visible:\s*topics\.map_visible/);
    });

    it('getTopicsWithLatestUpdate keeps the correlated MAX(updated_at) subquery for the sitemap', () => {
        const source = readSource(dataPath);
        const body = extractFunctionBody(source, 'getTopicsWithLatestUpdate');

        expect(body).toMatch(/last_image_updated_at:\s*sql<Date \| null>/);
        expect(body).toMatch(/SELECT MAX\(\$\{images\.updated_at\}\)/);
        expect(body).toMatch(/WHERE \$\{images\.topic\} = \$\{topics\.slug\}/);
    });

    it('getTopicsCached wraps the lean getTopics, not getTopicsWithLatestUpdate', () => {
        const source = readSource(dataPath);
        expect(source).toMatch(/export const getTopicsCached = cache\(getTopics\);/);
        expect(source).not.toMatch(/export const getTopicsCached = cache\(getTopicsWithLatestUpdate\);/);
    });

    it('sitemap.ts imports and calls getTopicsWithLatestUpdate, not the lean getTopics', () => {
        const source = readSource(sitemapPath);
        const importLine = source.split('\n').find((line) => line.includes("from '@/lib/data'"));
        if (!importLine) {
            throw new Error("Could not find the '@/lib/data' import line in sitemap.ts");
        }

        expect(importLine).toMatch(/\bgetTopicsWithLatestUpdate\b/);
        expect(source).toContain('getTopicsWithLatestUpdate()');
        // The sitemap's import must not name the lean accessor at all — it
        // needs last_image_updated_at, which getTopics() no longer provides.
        // `\b` word boundaries mean this does not match inside
        // `getTopicsWithLatestUpdate` (no boundary between "Topics" and "With"),
        // so only a literal bare `getTopics` import would trip this.
        expect(importLine).not.toMatch(/\bgetTopics\b/);
    });
});
