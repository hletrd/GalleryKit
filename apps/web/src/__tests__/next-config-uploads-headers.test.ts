/**
 * R4C6 ARCH-R4C6-06: one cache policy for image derivatives across every
 * layer that can serve them.
 *
 * Production evidence (run4-cycle6 review): public/ assets take
 * precedence over the app/uploads route handler, so Next's static
 * serving (default `public, max-age=0`) is what actually delivers
 * existing derivatives. The repo nginx config simultaneously declared
 * `immutable 1y` — unsafe against in-place backfill re-encodes — while
 * serve-upload.ts used `max-age=3600, must-revalidate`. These contracts
 * pin the unified policy in all three places.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const NEXT_CONFIG = readFileSync(resolve(__dirname, '../../next.config.ts'), 'utf-8');
const NGINX = readFileSync(resolve(__dirname, '../../nginx/default.conf'), 'utf-8');
const SERVE_UPLOAD = readFileSync(resolve(__dirname, '../lib/serve-upload.ts'), 'utf-8');

const POLICY = 'public, max-age=3600, must-revalidate';

describe('unified derivative cache policy (ARCH-R4C6-06)', () => {
    it('next.config headers() carries the uploads rule with the unified policy', () => {
        expect(NEXT_CONFIG).toMatch(/source: '\/uploads\/:format\(jpeg\|webp\|avif\)\/:file\*'/);
        const ruleIdx = NEXT_CONFIG.indexOf("source: '/uploads/:format(jpeg|webp|avif)/:file*'");
        const policyIdx = NEXT_CONFIG.indexOf(POLICY, ruleIdx);
        expect(policyIdx).toBeGreaterThan(ruleIdx);
    });

    it('nginx uploads location uses the unified policy and never immutable', () => {
        const locIdx = NGINX.indexOf('/uploads/(jpeg|webp|avif)/');
        expect(locIdx).toBeGreaterThan(-1);
        // Boundary-detection fix (run-10 c2): bound the slice at the uploads
        // location's own closing brace (newline + 4-space indent + `}`) — the
        // old `indexOf('location /')` boundary ran past `location ^~ …` blocks
        // (added for the public page limiter) into their prose comments, false-
        // positiving on the word "immutable" in a comment rather than in a
        // directive. A bare indexOf('}') would stop at the `{2}` quantifier
        // inside the location pattern itself; the indented close is unambiguous
        // (inner directives are 8-space indented).
        const nextLocIdx = NGINX.indexOf('\n    }', locIdx);
        expect(nextLocIdx).toBeGreaterThan(locIdx);
        const locBlock = NGINX.slice(locIdx, nextLocIdx);
        expect(locBlock).toContain(POLICY);
        expect(locBlock).not.toMatch(/immutable/);
        expect(locBlock).not.toMatch(/expires 1y/);
    });

    it('serve-upload.ts keeps the same policy on the paths it serves', () => {
        expect(SERVE_UPLOAD).toContain(POLICY);
        // and still rejects immutable by design (in-place re-encode hazard)
        expect(SERVE_UPLOAD).not.toMatch(/Cache-Control':\s*'[^']*immutable/);
    });
});
