/**
 * Source contracts over the SHIPPED service worker template
 * (`public/sw.template.js`) and its server-side counterpart in
 * `src/proxy.ts`.
 *
 * R4C6 COR-R4C6-05: the offline HTML fallback was provably dead in
 * production (every public page ships `no-store`, and the old
 * `hasAdminSession` guard read the forbidden Cookie header — always
 * null in SW fetch handlers). These contracts pin the fixed shape:
 * the explicit offline-only Cache-Control exemption gated on the
 * server-set `x-gk-admin-render` marker.
 *
 * NOTE: `lib/sw-cache.ts` is the unit-tested REFERENCE implementation;
 * the template is the shipped copy. Contracts here keep the two from
 * drifting apart (R4C6 TEST-R4C6-11).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TEMPLATE = readFileSync(
    resolve(__dirname, '../../public/sw.template.js'),
    'utf-8',
);
const PROXY = readFileSync(resolve(__dirname, '../proxy.ts'), 'utf-8');

describe('sw.template.js HTML offline fallback (COR-R4C6-05)', () => {
    it('never reads the forbidden request Cookie header', () => {
        expect(TEMPLATE).not.toMatch(/headers\.get\(['"]Cookie['"]\)/i);
        expect(TEMPLATE).not.toMatch(/hasAdminSession/);
    });

    it('excludes admin-session-rendered pages via the response marker', () => {
        expect(TEMPLATE).toMatch(
            /networkResponse\.headers\.get\('x-gk-admin-render'\) !== '1'/,
        );
    });

    it('the HTML put is gated on .ok AND the marker, in the same condition', () => {
        const cond = TEMPLATE.match(
            /if \(networkResponse\.ok && networkResponse\.headers\.get\('x-gk-admin-render'\) !== '1'\) \{/,
        );
        expect(cond).not.toBeNull();
        // and the gated block actually caches into the HTML cache
        const condIdx = TEMPLATE.indexOf(cond![0]);
        const putIdx = TEMPLATE.indexOf('htmlCache.put(request', condIdx);
        expect(putIdx).toBeGreaterThan(condIdx);
    });

    it('the image path keeps full isSensitiveResponse semantics', () => {
        const imageFn = TEMPLATE.slice(
            TEMPLATE.indexOf('async function staleWhileRevalidateImage'),
            TEMPLATE.indexOf('async function networkFirstHtml'),
        );
        expect(imageFn).toMatch(/isSensitiveResponse\(networkResponse\)/);
    });

    it('offline fallback still honours the 24 h TTL on served entries', () => {
        expect(TEMPLATE).toMatch(/age > HTML_MAX_AGE_MS/);
    });
});

describe('sw.template.js LRU accounting parity with lib/sw-cache.ts (TEST-R4C6-11)', () => {
    it('recordAndEvict only adjusts totals for entries actually deleted', () => {
        const fnIdx = TEMPLATE.indexOf('async function recordAndEvict');
        const fnEnd = TEMPLATE.indexOf('async function', fnIdx + 1);
        const fn = TEMPLATE.slice(fnIdx, fnEnd);
        expect(fn).toMatch(/const deleted = await imageCache\.delete\(entry\.url\);/);
        expect(fn).toMatch(/if \(deleted\) \{/);
    });
});

describe('sw.template.js lazy image revalidation (PERF-R4C9-02)', () => {
    const imageFn = () => TEMPLATE.slice(
        TEMPLATE.indexOf('async function staleWhileRevalidateImage'),
        TEMPLATE.indexOf('async function networkFirstHtml'),
    );

    it('the revalidating GET is NOT created eagerly at function entry', () => {
        // The defeated R11-M1 shape: `const revalidate = fetch(...)` started
        // the body fetch before the cache lookup, so a 304 probe could never
        // skip it. The GET must live behind a closure.
        expect(imageFn()).not.toMatch(/const revalidate\s*=\s*fetch\(/);
        expect(imageFn()).toMatch(/const startRevalidate\s*=\s*\(\)\s*=>/);
    });

    it('the 304 branch serves cached with a metadata touch and no body fetch', () => {
        const fn = imageFn();
        const head304 = fn.indexOf("head.status === 304");
        expect(head304).toBeGreaterThan(-1);
        const branchEnd = fn.indexOf('return cached;', head304);
        expect(branchEnd).toBeGreaterThan(head304);
        const branch = fn.slice(head304, branchEnd);
        expect(branch).toMatch(/touchMeta\(/);
        expect(branch).not.toMatch(/startRevalidate\(/);
    });

    it('touchMeta never grows a tracked size (no eviction trigger)', () => {
        const fnIdx = TEMPLATE.indexOf('async function touchMeta');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = TEMPLATE.slice(fnIdx, TEMPLATE.indexOf('async function', fnIdx + 1));
        expect(fn).toMatch(/existing && existing\.size \? existing\.size : knownSize/);
        expect(fn).not.toMatch(/recordAndEvict/);
    });

    it('cache-miss and ETag-mismatch paths still await the network response', () => {
        const fn = imageFn();
        expect(fn).toMatch(/const fresh = await startRevalidate\(\);/);
        expect(fn).toMatch(/const response = await startRevalidate\(\);/);
    });
});

describe('proxy.ts admin-render marker (COR-R4C6-05)', () => {
    it('sets x-gk-admin-render when the admin_session cookie is present', () => {
        const setIdx = PROXY.indexOf("headers.set('x-gk-admin-render', '1')");
        const guardIdx = PROXY.indexOf("request.cookies.get('admin_session')", PROXY.indexOf('const response ='));
        expect(setIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(setIdx);
    });
});
