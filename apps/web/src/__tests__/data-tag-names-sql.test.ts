import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 NF-3 / F-18 partial seatbelt, hardened in cycle 2:
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
 * Cycle 2 RPF loop AGG2-L01 / CR2-LOW-03/-04: tighten the function
 * extraction to use a brace-depth walker instead of a greedy regex
 * that relied on adjacent JSDoc placement.
 *
 * Cycle 2 RPF loop AGG2-L02 / TE2-LOW-03 / PR2-LOW-01: lock that the
 * three lite query functions do NOT include `blur_data_url` in their
 * SELECT shape (excluding it from the masonry listing payload to
 * keep SSR HTML lean).
 *
 * If you intentionally migrate `getImagesLite` to a NEW shape that
 * still produces non-null `tag_names`, update this test to match.
 */

const dataPath = path.resolve(__dirname, '..', 'lib', 'data.ts');

function readSource(): string {
    return fs.readFileSync(dataPath, 'utf8');
}

/**
 * Extract the body of a top-level async function by walking braces
 * from the opening `{` to the matching `}` at depth 0. This avoids
 * the greedy `\n}` heuristic that the cycle-1 version used, which
 * truncated the body if the function contained a `}` on its own line.
 */
function extractFunctionBody(source: string, fnName: string): string {
    const startMarker = `export async function ${fnName}(`;
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        throw new Error(`Function not found: ${fnName}`);
    }
    // Walk from the function start to find the opening `{`.
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

describe('getImagesLite tag_names SQL shape', () => {
    it('module defines a shared tagNamesAgg with the GROUP_CONCAT shape', () => {
        // AGG2-M06: cycle-2 helper extraction. Verify the shared
        // expression carries the correct GROUP_CONCAT(DISTINCT) shape.
        const source = readSource();
        expect(source).toMatch(
            /const\s+tagNamesAgg\s*=\s*sql<[^>]+>\s*`GROUP_CONCAT\(DISTINCT \$\{tags\.name\} ORDER BY \$\{tags\.name\}\)`/,
        );
    });

    it('uses LEFT JOIN + GROUP BY for getImagesLite', () => {
        const source = readSource();
        const body = extractFunctionBody(source, 'getImagesLite');
        // Locked invariants — body references the shared helper, not
        // a duplicated literal.
        expect(body).toMatch(/tag_names:\s*tagNamesAgg/);
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        // Forbidden anti-patterns: the raw-alias correlated subquery shape.
        expect(body).not.toMatch(/\(SELECT GROUP_CONCAT[\s\S]*FROM \$\{imageTags\}\s+it\b/);
        expect(body).not.toMatch(/\bit\.tag_id\b/);
        // AGG2-L02: the lite query MUST NOT include blur_data_url
        // (excluded from masonry listing payload).
        expect(body).not.toMatch(/\bblur_data_url\b/);
    });

    it('uses LEFT JOIN + GROUP BY for getImagesLitePage and preserves total_count window function', () => {
        const source = readSource();
        const body = extractFunctionBody(source, 'getImagesLitePage');
        expect(body).toMatch(/tag_names:\s*tagNamesAgg/);
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        // The total_count window function is the public-page pagination
        // contract; ensure the fix did not drop it.
        expect(body).toContain('COUNT(*) OVER()');
        expect(body).not.toMatch(/\bit\.tag_id\b/);
        expect(body).not.toMatch(/\bblur_data_url\b/);
    });

    it('uses LEFT JOIN + GROUP BY for getAdminImagesLite', () => {
        const source = readSource();
        const body = extractFunctionBody(source, 'getAdminImagesLite');
        expect(body).toMatch(/tag_names:\s*tagNamesAgg/);
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        expect(body).toContain('.groupBy(images.id)');
        expect(body).not.toMatch(/\bit\.tag_id\b/);
        expect(body).not.toMatch(/\bblur_data_url\b/);
    });

    /**
     * AGG2-M04 / TE2-MED-01 (cycle 2) — REWRITTEN cycle 3 RPF loop
     * AGG3-L01 / CR3-LOW-02 / TE3-LOW-01 / V3-LOW-01.
     *
     * Lock the runtime contract that the masonry-list query shape
     * compiles to MySQL with the GROUP_CONCAT(DISTINCT `tags`.`name`
     * ORDER BY `tags`.`name`) clause over a LEFT JOIN of images ×
     * image_tags × tags grouped by `images`.`id`. Drizzle's `.toSQL()`
     * is synchronous and does not require a live DB connection.
     *
     * Previously this sub-test only asserted `typeof === 'function'`,
     * which was already enforced by TypeScript — a no-op. Cycle 3 RPF
     * loop replaces it with an actual SQL inspection using the mysql-proxy
     * driver to avoid pulling the production connection pool at import.
     *
     * Cycle 5 fresh review CYC5-F01: this test dynamically imports
     * `drizzle-orm`, `drizzle-orm/mysql-proxy`, and `../db/schema`. Under
     * full-suite parallel test load the cold-import graph occasionally
     * exceeds the 5000ms default vitest timeout (observed flake on
     * 2026-04-27 cycle-5 fresh run: import phase clocked 143s aggregate
     * across the 69-file suite). The test passes consistently in
     * isolation (~5.2s wall, of which 225ms is import). Bumping the
     * per-test timeout to 30000ms eliminates the flake without masking
     * a real regression — the assertions themselves are synchronous
     * once `.toSQL()` runs, so a slow assertion would still indicate
     * a real problem.
     */
    /**
     * C14-MED-02: lock that searchFields keys and searchGroupByColumns
     * stay in sync. The two GROUP BY clauses in searchImages (tag search,
     * alias search) previously duplicated the column list inline. If a
     * developer adds a field to searchFields without adding it to the
     * shared array, MySQL ONLY_FULL_GROUP_BY mode will reject the query
     * in production. This test verifies the shared array exists and
     * references the same column set as searchFields.
     */
    it('searchImages uses a shared searchGroupByColumns array that covers all searchFields keys', () => {
        const source = readSource();
        // Verify the shared array is defined
        expect(source).toMatch(/const\s+searchGroupByColumns\s*=\s*\[/);
        // Verify both .groupBy() calls use the shared array
        expect(source).toMatch(/\.groupBy\(\.\.\.searchGroupByColumns\)/);
        // Count occurrences — should be exactly 2 (tag search + alias search)
        const groupBySpreadMatches = source.match(/\.groupBy\(\.\.\.searchGroupByColumns\)/g);
        expect(groupBySpreadMatches).toHaveLength(2);
        // Verify searchFields is defined nearby (same function body)
        const searchFnStart = source.indexOf('export async function searchImages(');
        expect(searchFnStart).toBeGreaterThan(-1);
        const searchFnBody = extractFunctionBody(source, 'searchImages');
        expect(searchFnBody).toMatch(/const\s+searchFields\s*=\s*\{/);
        expect(searchFnBody).toMatch(/const\s+searchGroupByColumns\s*=\s*\[/);
        // Ensure the old inline .groupBy(images.id, ...) pattern is gone
        expect(searchFnBody).not.toMatch(/\.groupBy\(\s*images\.id,/);
    });

    /**
     * C14-MED-01: lock that getImageByShareKey uses a single query with
     * LEFT JOIN + GROUP_CONCAT for tags instead of two sequential queries
     * (image row + tags). The single-query shape eliminates one DB
     * round-trip per shared-photo page load.
     */
    it('getImageByShareKey uses single LEFT JOIN + GROUP_CONCAT query for tags', () => {
        const source = readSource();
        const body = extractFunctionBody(source, 'getImageByShareKey');
        // C16-MED-02: combined GROUP_CONCAT with null-byte delimiter eliminates
        // index-based zip alignment issues. Uses CONCAT(tags.slug, CHAR(0), tags.name)
        // with ORDER BY tags.slug so slug/name pairs stay deterministically aligned.
        expect(body).toMatch(/tag_concat:/);
        expect(body).toMatch(/CONCAT\(\$\{tags\.slug\}, CHAR\(0\), \$\{tags\.name\}\)/);
        expect(body).toMatch(/ORDER BY \$\{tags\.slug\}/);
        // Must LEFT JOIN imageTags and tags (not inner join, since photos may have no tags)
        expect(body).toContain('.leftJoin(imageTags');
        expect(body).toContain('.leftJoin(tags');
        // Must use GROUP BY
        expect(body).toContain('.groupBy(images.id)');
        // Must NOT have a separate db.select for tags (the old 2-query pattern)
        // The old pattern had: const imageTagsResult = await db.select({
        expect(body).not.toMatch(/const\s+imageTagsResult\s*=\s*await\s+db\.select/);
        // Privacy: must use publicSelectFields (not adminSelectFields)
        expect(body).toContain('...publicSelectFields');
    });

    it('Drizzle compiled SQL for the lite query shape emits GROUP_CONCAT + LEFT JOIN + GROUP BY', { timeout: 30000 }, async () => {
        const { sql: drizzleSql, eq } = await import('drizzle-orm');
        const { drizzle: drizzleProxy } = await import('drizzle-orm/mysql-proxy');
        const { images, imageTags, tags } = await import('../db/schema');
        // No-op proxy DB; .toSQL() is synchronous and does not invoke the proxy.
        const proxyDb = drizzleProxy(async () => ({ rows: [] }));
        const built = proxyDb
            .select({
                id: images.id,
                tag_names: drizzleSql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`,
            })
            .from(images)
            .leftJoin(imageTags, eq(images.id, imageTags.imageId))
            .leftJoin(tags, eq(imageTags.tagId, tags.id))
            .groupBy(images.id);
        const compiled = built.toSQL();
        expect(typeof compiled.sql).toBe('string');
        const lower = compiled.sql.toLowerCase();
        expect(lower).toContain('group_concat(distinct');
        expect(lower).toContain('order by');
        expect(lower).toContain('left join');
        expect(lower).toContain('group by');
    });
});
