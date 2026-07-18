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
 *     the exported pure helpers `isUniversalPriorityCard` / `resolveTopicLabel`
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
import { isUniversalPriorityCard, resolveTopicLabel } from '@/components/home-client';
import { getMainMasonrySizes } from '@/lib/responsive-masonry';

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
    itemCount: number,
    estimatedCardWidth: number,
    topicsMap: Record<string, string>,
    imageSizes: number[],
    onLinkClick: () => void,
) {
    return {
        image,
        estimatedCardWidth,
        isPriority: isUniversalPriorityCard(index, itemCount),
        topicLabel: resolveTopicLabel(image.topic, topicsMap),
        imageSizes,
        responsiveSizes: getMainMasonrySizes(itemCount),
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
        expect(mapCall).toContain('isPriority={isUniversalPriorityCard(index, itemCount)}');
        expect(mapCall).toContain('topicLabel={resolveTopicLabel(image.topic, topicsMap)}');
        // imageSizes is passed by reference, not spread into a new array.
        expect(mapCall).toContain('imageSizes={imageSizes}');
        expect(mapCall).toContain('responsiveSizes={responsiveSizes}');
        expect(mapCall).toContain('onLinkClick={saveScrollPosition}');
    });

    it('does not preload DOM-first cards as visual CSS-column leaders', () => {
        const src = readSrc('components/home-client.tsx');
        expect(src).toContain("const [count, setCount] = useState(1)");
        expect(src).not.toContain("import { preload } from 'react-dom'");
        expect(src).not.toContain('DESKTOP_FIRST_ROW_MEDIA');
        expect(src).not.toContain('preloadResponsiveFirstRow');
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

        const prevImages = [
            imgA,
            imgB,
            { id: 3, topic: 'travel' },
            { id: 4, topic: 'travel' },
            { id: 5, topic: 'travel' },
        ];
        const newImages: FixtureImage[] = [{ id: 6, topic: 'travel' }];
        // Literal replica of home-client.tsx's handleLoadMore reducer.
        const nextImages = [...prevImages, ...newImages];

        expect(nextImages[0]).toBe(imgA);
        expect(nextImages[1]).toBe(imgB);

        const estimatedCardWidth = 300;

        for (const index of [0, 1]) {
            const before = buildCardProps(prevImages[index], index, prevImages.length, estimatedCardWidth, topicsMap, imageSizes, onLinkClick);
            const after = buildCardProps(nextImages[index], index, nextImages.length, estimatedCardWidth, topicsMap, imageSizes, onLinkClick);
            expect(shallowEqual(before, after), `card at index ${index} should have unchanged props after append`).toBe(true);
        }
    });

    it('an append that changes the effective column cap updates responsiveSizes', () => {
        const imgA: FixtureImage = { id: 1, topic: 'travel' };
        const topicsMap = { travel: 'Travel' };
        const imageSizes = [640, 1536, 2048];
        const onLinkClick = () => {};

        const atTwoItems = buildCardProps(imgA, 0, 2, 300, topicsMap, imageSizes, onLinkClick);
        const atThreeItems = buildCardProps(imgA, 0, 3, 300, topicsMap, imageSizes, onLinkClick);
        expect(atTwoItems.responsiveSizes).not.toBe(atThreeItems.responsiveSizes);
        expect(shallowEqual(atTwoItems, atThreeItems)).toBe(false);
    });

    it('a viewport-bucket change (estimatedCardWidth) changes props so memo does NOT bail out', () => {
        const imgA: FixtureImage = { id: 1, topic: 'travel' };
        const topicsMap = { travel: 'Travel' };
        const imageSizes = [640, 1536, 2048];
        const onLinkClick = () => {};

        const atWidth300 = buildCardProps(imgA, 0, 2, 300, topicsMap, imageSizes, onLinkClick);
        const atWidth420 = buildCardProps(imgA, 0, 2, 420, topicsMap, imageSizes, onLinkClick);
        expect(shallowEqual(atWidth300, atWidth420)).toBe(false);
    });
});

describe('C2-19 priority / topic-label pure helpers', () => {
    it('flags only the universal first CSS-column item for explicit priority', () => {
        expect(isUniversalPriorityCard(0, 5)).toBe(true);
        expect(isUniversalPriorityCard(2, 5)).toBe(false);
        expect(isUniversalPriorityCard(1, 2)).toBe(false);
        expect(isUniversalPriorityCard(0, 0)).toBe(false);
    });

    it('resolveTopicLabel prefers the resolved label, falling back to the raw slug', () => {
        expect(resolveTopicLabel('travel', { travel: 'Travel' })).toBe('Travel');
        expect(resolveTopicLabel('unknown-slug', { travel: 'Travel' })).toBe('unknown-slug');
        expect(resolveTopicLabel(undefined, { travel: 'Travel' })).toBeUndefined();
    });
});
