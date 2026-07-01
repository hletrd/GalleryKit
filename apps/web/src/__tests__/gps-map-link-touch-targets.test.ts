import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CASES = [
    ['photo viewer', '../components/photo-viewer.tsx'],
    ['info bottom sheet', '../components/info-bottom-sheet.tsx'],
] as const;

function mapAnchorOpening(source: string): string {
    const hrefIndex = source.indexOf('https://www.google.com/maps/search/?api=1&query=');
    expect(hrefIndex).toBeGreaterThanOrEqual(0);
    const anchorStart = source.lastIndexOf('<a', hrefIndex);
    expect(anchorStart).toBeGreaterThanOrEqual(0);
    const anchorEnd = source.indexOf('>', hrefIndex);
    expect(anchorEnd).toBeGreaterThan(hrefIndex);
    return source.slice(anchorStart, anchorEnd);
}

describe('admin GPS map link touch targets', () => {
    it.each(CASES)('%s Google Maps link exposes at least a 44 px target', (_label, relPath) => {
        const source = readFileSync(resolve(__dirname, relPath), 'utf8');
        const opening = mapAnchorOpening(source);

        expect(opening).toContain('inline-flex');
        expect(opening).toContain('min-h-11');
        expect(opening).toContain('min-w-11');
        expect(opening).toContain('items-center');
    });
});
