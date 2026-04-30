import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataSource = readFileSync(resolve(__dirname, '..', 'lib', 'data.ts'), 'utf8');
const getImageSource = dataSource.slice(
    dataSource.indexOf('export async function getImage'),
    dataSource.indexOf('export async function getSharedGroup'),
);
const getSharedGroupSource = dataSource.slice(
    dataSource.indexOf('export async function getSharedGroup'),
    dataSource.indexOf('export async function searchImages'),
);

describe('getImage gallery adjacency source contract', () => {
    it('selects the closest previous row across NULL capture-date boundaries', () => {
        expect(getImageSource).toContain('orderBy(asc(images.capture_date), asc(images.created_at), asc(images.id))');
    });

    it('lets dated images navigate forward into the undated tail of the gallery order', () => {
        // C6-AGG6R-01: The old inline ternary pattern (isNull : sql`FALSE`) was
        // replaced with dynamic condition arrays. For dated images, isNull is
        // pushed as a prev condition; for undated images, IS NULL is pushed
        // directly. Both ensure dated images can navigate to undated neighbors.
        expect(getImageSource).toContain('isNull(images.capture_date)');
        // Verify no sql`FALSE` is used as a runtime expression (only in comments).
        // The source may mention sql`FALSE` in a comment explaining the refactor;
        // the assertion ensures it's not in a code position (after `:` or `?`).
        const falseInCode = getImageSource.match(/[:?]\s*sql`FALSE`/);
        expect(falseInCode).toBeNull();
    });

    it('treats groups with no remaining images as inaccessible', () => {
        expect(getSharedGroupSource).toContain('if (imagesWithTags.length === 0)');
        expect(getSharedGroupSource).toMatch(/if \(imagesWithTags\.length === 0\) \{\s*return null;\s*\}/);
    });
});
