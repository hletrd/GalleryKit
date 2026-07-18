/**
 * C2-19 (run-10 c2, PERF-09) — memoized MasonryCard.
 *
 * home-client.tsx's orderedImages.map used to inline the entire per-card
 * render (title/alt derivation, isWideGamutPrimary, srcset strings), so that
 * work re-ran for EVERY loaded card on every allImages append (infinite
 * scroll), viewport-bucket change, or unrelated state flip (e.g.
 * showBackToTop). The card was extracted into `components/masonry-card.tsx`
 * as a `React.memo` component (`MasonryCard`) so an unrelated re-render of
 * the parent bails out for cards whose own props did not change.
 *
 * Environment note (mirrors `cycle-r10c1-a11y-contracts.test.ts`): this
 * repo's vitest config runs under the default `node` environment with no
 * `jsdom`/`happy-dom` and no `@testing-library/react` / `react-test-renderer`
 * dependency (checked: none appear in apps/web/package.json or
 * node_modules), so an actual mount-then-rerender-then-observe-commit test
 * (e.g. via `<Profiler onRender>`) cannot run here without adding a new test
 * dependency. Instead this file proves the memoization contract two ways:
 *
 *  1. A source-contract check that `MasonryCard` is really `memo(...)`-
 *     wrapped, and that the parent passes it the exact prop set documented
 *     below (not a derived/cloned object).
 *  2. A value-level behavioral test that builds the REAL per-card props via
 *     the exported pure helpers `computeIsAboveFold` / `resolveTopicLabel`
 *     (the same functions home-client.tsx calls) and a literal replica of
 *     home-client.tsx's `setAllImages(prev => [...prev, ...newImages])`
 *     append, then applies `shallowEqual` — the same single-level
 *     `Object.is`-per-own-key comparison React's default `memo` comparator
 *     uses (react.dev/reference/react/memo: "shallowly compare the old and
 *     new props") — to prove that an existing card's props are referentially
 *     unchanged after an append (so `memo` would bail out), while a
 *     viewport-bucket change (which SHOULD force a re-render) changes them.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeIsAboveFold, computeShouldEagerLoad, resolveTopicLabel } from '@/components/home-client';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

// Mirrors React's public default `memo` comparator contract: a single-level
// Object.is comparison over each own enumerable key. Not a reimplementation
// of a private React internal — this is the documented, stable behavior of
// `memo()` with no custom `arePropsEqual` argument.
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (!Object.is(a[key], b[key])) return false;
    }
    return true;
}

interface FixtureImage {
    id: number;
    topic?: string;
}

// Replicates the exact prop set home-client.tsx passes to <MasonryCard> (see
// the source-contract test below, which pins this shape against the real
// JSX so the two cannot silently drift apart).
function buildCardProps(
    image: FixtureImage,
    index: number,
    columnCount: number,
    itemCount: number,
    estimatedCardWidth: number,
    topicsMap: Record<string, string>,
    imageSizes: number[],
    onLinkClick: () => void,
) {
    return {
        image,
        estimatedCardWidth,
        isAboveFold: computeIsAboveFold(index, columnCount, itemCount),
        shouldEagerLoad: computeShouldEagerLoad(index, columnCount, itemCount, true),
        topicLabel: resolveTopicLabel(image.topic, topicsMap),
        imageSizes,
        onLinkClick,
    };
}

describe('C2-19 MasonryCard memoization contract', () => {
    it('MasonryCard is exported as a memo(...)-wrapped component', () => {
        const src = readSrc('components/masonry-card.tsx');
        expect(src).toContain("import { memo } from 'react'");
        expect(src).toMatch(/export const MasonryCard = memo\(MasonryCardImpl\)/);
    });

    it('disambiguates duplicate visible titles in link accessible names', () => {
        const src = readSrc('components/masonry-card.tsx');
        expect(src).toContain('const accessibleTitle = `${displayTitle} #${image.id}`;');
        expect(src).toContain("t('aria.viewPhoto', { title: accessibleTitle })");
        expect(src).toContain('aria-label={photoAriaLabel}');
    });

    it('home-client.tsx passes the stable prop set (no derived/cloned objects) into MasonryCard', () => {
        const src = readSrc('components/home-client.tsx');
        const mapCall = src.slice(src.indexOf('orderedImages.map'), src.indexOf('</GridPictureFallbackBoundary>'));
        expect(mapCall).toContain('<MasonryCard');
        expect(mapCall).toContain('key={image.id}');
        // The `image` prop is the loop element itself, not a spread/derived copy.
        expect(mapCall).toContain('image={image}');
        expect(mapCall).toContain('estimatedCardWidth={estimatedCardWidth}');
        expect(mapCall).toContain('isAboveFold={computeIsAboveFold(index, columnCount, itemCount)}');
        expect(mapCall).toContain('shouldEagerLoad={computeShouldEagerLoad(index, columnCount, itemCount, viewportWidth > 0)}');
        expect(mapCall).toContain('topicLabel={resolveTopicLabel(image.topic, topicsMap)}');
        // imageSizes is passed by reference, not spread into a new array.
        expect(mapCall).toContain('imageSizes={imageSizes}');
        expect(mapCall).toContain('onLinkClick={saveScrollPosition}');
    });

    it('handleLoadMore appends via array spread, preserving existing entry identity', () => {
        const src = readSrc('components/home-client.tsx');
        expect(src).toContain('setAllImages(prev => [...prev, ...newImages])');
        // Not a .map()/clone of prev entries.
        expect(src).not.toMatch(/setAllImages\(prev => prev\.map/);
    });

    it('saveScrollPosition is a useCallback keyed only on scrollKey (stable across renders)', () => {
        const src = readSrc('components/home-client.tsx');
        const fn = src.slice(src.indexOf('const saveScrollPosition ='), src.indexOf('const saveScrollPosition =') + 260);
        expect(fn).toMatch(/useCallback\(\(\) => \{/);
        expect(fn).toContain('}, [scrollKey]);');
    });

    it('an existing card keeps referentially-identical MasonryCard props across a load-more append', () => {
        const imgA: FixtureImage = { id: 1, topic: 'travel' };
        const imgB: FixtureImage = { id: 2, topic: 'travel' };
        const topicsMap = { travel: 'Travel' };
        const imageSizes = [640, 1536, 2048];
        const onLinkClick = () => {};

        const prevImages = [imgA, imgB];
        const newImages: FixtureImage[] = [{ id: 3, topic: 'travel' }];
        // Literal replica of home-client.tsx's handleLoadMore reducer.
        const nextImages = [...prevImages, ...newImages];

        expect(nextImages[0]).toBe(imgA);
        expect(nextImages[1]).toBe(imgB);

        const columnCount = 3;
        const estimatedCardWidth = 300;

        for (const index of [0, 1]) {
            const before = buildCardProps(prevImages[index], index, columnCount, prevImages.length, estimatedCardWidth, topicsMap, imageSizes, onLinkClick);
            const after = buildCardProps(nextImages[index], index, columnCount, nextImages.length, estimatedCardWidth, topicsMap, imageSizes, onLinkClick);
            expect(shallowEqual(before, after), `card at index ${index} should have unchanged props after append`).toBe(true);
        }
    });

    it('a viewport-bucket change (estimatedCardWidth) changes props so memo does NOT bail out', () => {
        const imgA: FixtureImage = { id: 1, topic: 'travel' };
        const topicsMap = { travel: 'Travel' };
        const imageSizes = [640, 1536, 2048];
        const onLinkClick = () => {};

        const atWidth300 = buildCardProps(imgA, 0, 3, 2, 300, topicsMap, imageSizes, onLinkClick);
        const atWidth420 = buildCardProps(imgA, 0, 3, 2, 420, topicsMap, imageSizes, onLinkClick);
        expect(shallowEqual(atWidth300, atWidth420)).toBe(false);
    });

    it('an above-fold transition (column count shrink) changes props so memo does NOT bail out', () => {
        const imgA: FixtureImage = { id: 1, topic: 'travel' };
        const topicsMap = { travel: 'Travel' };
        const imageSizes = [640, 1536, 2048];
        const onLinkClick = () => {};

        // index 2 is above-fold at columnCount=3 but not at columnCount=2.
        const atColumns3 = buildCardProps(imgA, 2, 3, 5, 300, topicsMap, imageSizes, onLinkClick);
        const atColumns2 = buildCardProps(imgA, 2, 2, 5, 300, topicsMap, imageSizes, onLinkClick);
        expect(atColumns3.isAboveFold).toBe(true);
        expect(atColumns2.isAboveFold).toBe(false);
        expect(shallowEqual(atColumns3, atColumns2)).toBe(false);
    });
});

describe('C2-19 computeIsAboveFold / resolveTopicLabel pure helpers', () => {
    it('computeIsAboveFold flags exactly the first min(columnCount, itemCount) indices', () => {
        expect(computeIsAboveFold(0, 3, 5)).toBe(true);
        expect(computeIsAboveFold(2, 3, 5)).toBe(true);
        expect(computeIsAboveFold(3, 3, 5)).toBe(false);
        // itemCount smaller than columnCount clamps the above-fold window.
        expect(computeIsAboveFold(1, 5, 2)).toBe(true);
        expect(computeIsAboveFold(2, 5, 2)).toBe(false);
    });

    it('eager-loads a maximum first row before viewport measurement', () => {
        expect(computeShouldEagerLoad(4, 2, 10, false)).toBe(true);
        expect(computeShouldEagerLoad(5, 2, 10, false)).toBe(false);
        expect(computeShouldEagerLoad(1, 2, 10, true)).toBe(true);
        expect(computeShouldEagerLoad(2, 2, 10, true)).toBe(false);
    });

    it('resolveTopicLabel prefers the resolved label, falling back to the raw slug', () => {
        expect(resolveTopicLabel('travel', { travel: 'Travel' })).toBe('Travel');
        expect(resolveTopicLabel('unknown-slug', { travel: 'Travel' })).toBe('unknown-slug');
        expect(resolveTopicLabel(undefined, { travel: 'Travel' })).toBeUndefined();
    });
});
