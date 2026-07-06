import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CR3-02 / C3-24 (run-10 c3) — OptimisticImage retry base after a failed
 * fallback. The pre-fix handleError built every retry URL from the original
 * `src` prop even after switching to `fallbackSrc`, so a transiently-failing
 * fallback got exactly one attempt while the known-dead original burned all
 * the retries. The branch is currently unreachable (no caller passes
 * `fallbackSrc`) — this pin keeps the trap closed for the first caller that
 * wires it. (Source contract: the repo has no jsdom/RTL harness for
 * component behavior tests — see masonry-card-memo.test.ts.)
 */

const source = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'optimistic-image.tsx'),
    'utf8',
);

describe('OptimisticImage retry-base contract (C3-24)', () => {
    it('tracks a retry base ref seeded from src', () => {
        expect(source).toMatch(/const retryBaseRef = useRef\(src\);/);
    });

    it('switches the retry base to the fallback when the fallback branch is taken', () => {
        expect(source).toMatch(/retryBaseRef\.current = fallbackSrc;/);
    });

    it('builds retry URLs from the base, never directly from the src prop', () => {
        expect(source).toMatch(/setImgSrc\(`\$\{base\}\$\{separator\}retry=\$\{nextRetry\}`\)/);
        expect(source).not.toMatch(/setImgSrc\(`\$\{src\}/);
    });

    it('does not re-enter the fallback switch once the base is already the fallback', () => {
        expect(source).toMatch(/retryBaseRef\.current !== fallbackSrc/);
    });
});
