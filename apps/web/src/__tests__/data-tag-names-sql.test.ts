import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 NF-3 / F-18 partial seatbelt:
 *
 * The masonry listing query `getImagesLite`/`getImagesLitePage` previously
 * shipped a correlated scalar subquery for `tag_names` that used raw SQL
 * aliases (`it`, `t`, `it.tag_id`, `it.image_id`) inside the
 * Drizzle `sql` template. In production this returned NULL for every
 * row, breaking the F-18 humanize fix wave so every masonry-grid card
 * read as "View photo: Untitled" and every <img alt="Photo">.
 *
 * The fix moved to a LEFT JOIN + GROUP BY + Drizzle column references,
 * matching the working `getImages()` pattern. This fixture-style test
 * locks the shape of the query so a future refactor cannot silently
 * regress to the broken correlated-subquery / raw-string-alias shape.
 *
 * If you intentionally migrate `getImagesLite` to a NEW shape that
 * still produces non-null `tag_names`, update this test to match.
 */

const dataPath = path.resolve(__dirname, '..', 'lib', 'data.ts');

function readSource(): string {
    return fs.readFileSync(dataPath, 'utf8');
}

describe('getImagesLite tag_names SQL shape', () => {
    it('uses LEFT JOIN + GROUP BY for getImagesLite', () => {
        const source = readSource();
        const fnMatch = source.match(/export async function getImagesLite\([^)]*\)[\s\S]*?\n\}/m);
        expect(fnMatch, 'getImagesLite must exist').toBeTruthy();
        const body = fnMatch![0];
        // Locked invariants:
        expect(body).toContain('GROUP_CONCAT(DISTINCT ${tags.name}');
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        // Forbidden anti-patterns: the raw-alias correlated subquery shape.
        expect(body).not.toMatch(/\(SELECT GROUP_CONCAT[\s\S]*FROM \$\{imageTags\}\s+it\b/);
        expect(body).not.toMatch(/\bit\.tag_id\b/);
    });

    it('uses LEFT JOIN + GROUP BY for getImagesLitePage and preserves total_count window function', () => {
        const source = readSource();
        const fnMatch = source.match(/export async function getImagesLitePage\([\s\S]*?\n\}\s*\n\s*\/\*\*/m);
        expect(fnMatch, 'getImagesLitePage must exist').toBeTruthy();
        const body = fnMatch![0];
        expect(body).toContain('GROUP_CONCAT(DISTINCT ${tags.name}');
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        // The total_count window function is the public-page pagination
        // contract; ensure the fix did not drop it.
        expect(body).toContain('COUNT(*) OVER()');
        expect(body).not.toMatch(/\bit\.tag_id\b/);
    });

    it('uses LEFT JOIN + GROUP BY for getAdminImagesLite', () => {
        const source = readSource();
        const fnMatch = source.match(/export async function getAdminImagesLite\([\s\S]*?\n\}/m);
        expect(fnMatch, 'getAdminImagesLite must exist').toBeTruthy();
        const body = fnMatch![0];
        expect(body).toContain('GROUP_CONCAT(DISTINCT ${tags.name}');
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        expect(body).not.toMatch(/\bit\.tag_id\b/);
    });
});
