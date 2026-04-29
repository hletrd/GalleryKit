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
        expect(getImageSource).toMatch(/image\.capture_date\s*\?\s*isNull\(images\.capture_date\)\s*:\s*sql`FALSE`/);
    });

    it('treats groups with no remaining images as inaccessible', () => {
        expect(getSharedGroupSource).toContain('if (imagesWithTags.length === 0)');
        expect(getSharedGroupSource).toMatch(/if \(imagesWithTags\.length === 0\) \{\s*return null;\s*\}/);
    });
});
