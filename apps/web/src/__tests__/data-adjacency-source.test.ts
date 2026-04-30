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

    it('returns group with empty images instead of null (C6F-01)', () => {
        // C6F-01: getSharedGroup now returns the group even when all images
        // are still processing (empty imagesWithTags), so the page shows a
        // meaningful state instead of a 404. The old early-return null was
        // removed. Verify the "return null" pattern is gone and the group
        // is always returned with the images array.
        expect(getSharedGroupSource).not.toMatch(/if \(imagesWithTags\.length === 0\) \{\s*return null;\s*\}/);
        expect(getSharedGroupSource).toContain('images: imagesWithTags');
    });
});
