import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function routeSource(route: 's' | 'g') {
    return readFileSync(resolve(__dirname, '..', 'app', '[locale]', '(public)', route, '[key]', 'page.tsx'), 'utf8');
}

describe('public share route lookup throttling', () => {
    it('rate-limits single-photo share metadata before DB lookup', () => {
        const source = routeSource('s');
        const metadata = source.slice(source.indexOf('export async function generateMetadata'), source.indexOf('export default async function'));

        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBeGreaterThan(-1);
        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBeLessThan(metadata.indexOf('getImageByShareKeyCached(key)'));
    });

    it('rate-limits group share metadata before DB lookup', () => {
        const source = routeSource('g');
        const metadata = source.slice(source.indexOf('export async function generateMetadata'), source.indexOf('export default async function'));

        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBeGreaterThan(-1);
        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBeLessThan(metadata.indexOf('getSharedGroupCached(key'));
    });
});
