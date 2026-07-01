import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/(protected)/analytics/analytics-client.tsx'),
    'utf8',
);

function anchorOpeningFor(hrefSnippet: string): string {
    const hrefIndex = SOURCE.indexOf(hrefSnippet);
    expect(hrefIndex).toBeGreaterThanOrEqual(0);
    const anchorStart = SOURCE.lastIndexOf('<a', hrefIndex);
    expect(anchorStart).toBeGreaterThanOrEqual(0);
    const anchorEnd = SOURCE.indexOf('>', hrefIndex);
    expect(anchorEnd).toBeGreaterThan(hrefIndex);
    return SOURCE.slice(anchorStart, anchorEnd);
}

describe('admin analytics link touch targets', () => {
    it.each([
        ['top photo', 'href={localizePath(locale, `/p/${row.imageId}`)}'],
        ['top shared album', 'href={localizePath(locale, `/g/${row.shareKey}`)}'],
    ])('%s links expose at least a 44 px target', (_label, hrefSnippet) => {
        const opening = anchorOpeningFor(hrefSnippet);

        expect(opening).toContain('inline-flex');
        expect(opening).toContain('min-h-11');
        expect(opening).toContain('min-w-11');
        expect(opening).toContain('items-center');
    });
});
