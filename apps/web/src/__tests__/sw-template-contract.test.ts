/**
 * Source contracts over the SHIPPED service worker template
 * (`public/sw.template.js`) and its server-side counterpart in
 * `src/proxy.ts`.
 *
 * R4C6 COR-R4C6-05: the offline HTML fallback was provably dead in
 * production (dynamic public gallery/photo pages ship `no-cache`, and the old
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
import { Script } from 'vm';

const TEMPLATE = readFileSync(
    resolve(__dirname, '../../public/sw.template.js'),
    'utf-8',
);
const BUILD_SW = readFileSync(resolve(__dirname, '../../scripts/build-sw.ts'), 'utf-8');
const PROXY = readFileSync(resolve(__dirname, '../proxy.ts'), 'utf-8');
const GENERATED_SW = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf-8');

type RevocableShareHtmlRouteClassifier = (pathname: string) => boolean;

function loadRevocableShareHtmlRouteClassifier(source: string, label: string): RevocableShareHtmlRouteClassifier {
    const start = source.indexOf('function isRevocableShareHtmlRoute');
    const end = source.indexOf('function isSensitiveResponse', start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to locate isRevocableShareHtmlRoute in ${label}`);
    }

    const classifier = new Script(`(${source.slice(start, end).trim()})`, { filename: label })
        .runInNewContext({}) as unknown;
    if (typeof classifier !== 'function') {
        throw new Error(`isRevocableShareHtmlRoute did not evaluate to a function in ${label}`);
    }

    return classifier as RevocableShareHtmlRouteClassifier;
}

const WORKER_CLASSIFIERS = [
    {
        label: 'template',
        classify: loadRevocableShareHtmlRouteClassifier(TEMPLATE, 'sw.template.js'),
    },
    {
        label: 'generated worker',
        classify: loadRevocableShareHtmlRouteClassifier(GENERATED_SW, 'sw.js'),
    },
] as const;

describe('sw.template.js HTML offline fallback (COR-R4C6-05)', () => {
    it('generates sw.js from a deterministic template-plus-pipeline stamp', () => {
        expect(BUILD_SW).toContain("import { createHash } from 'crypto'");
        expect(BUILD_SW).toContain('PIPELINE=${IMAGE_PIPELINE_VERSION}');
        expect(BUILD_SW).not.toContain('execFileSync');
        expect(BUILD_SW).not.toContain('rev-parse');
        expect(BUILD_SW).not.toContain('Date.now()');
    });

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

    it('bypasses revocable share pages and public object pages instead of offline-caching them', () => {
        expect(TEMPLATE).toMatch(/function isRevocableShareHtmlRoute\(pathname\)/);
        expect(TEMPLATE).toContain('[csg]\\/[^/]+');
        expect(TEMPLATE).toMatch(/map\\\/\?\$/);
        const fetchHandler = TEMPLATE.slice(TEMPLATE.indexOf("self.addEventListener('fetch'"));
        const shareBypassIdx = fetchHandler.indexOf('isRevocableShareHtmlRoute(pathname) && isHtmlRoute(request)');
        const htmlCacheIdx = fetchHandler.indexOf('event.respondWith(networkFirstHtml(request, event))');
        expect(shareBypassIdx).toBeGreaterThan(-1);
        expect(htmlCacheIdx).toBeGreaterThan(shareBypassIdx);
    });

    it('keeps normal photo pages eligible for the offline HTML fallback', () => {
        const classifier = TEMPLATE.slice(
            TEMPLATE.indexOf('function isRevocableShareHtmlRoute'),
            TEMPLATE.indexOf('function isSensitiveResponse'),
        );

        expect(classifier).not.toContain('p\\/\\d+');
        expect(classifier).toContain('[csg]\\/[^/]+');
        expect(classifier).toMatch(/map\\\/\?\$/);
    });

    it('classifies concrete revocable/share routes identically in the template and generated worker', () => {
        const cases = [
            ['/p/123', false],
            ['/ko/p/123', false],
            ['/en-US/p/123', false],
            ['/s/share-key', true],
            ['/ko/s/share-key', true],
            ['/g/group-key', true],
            ['/ko/g/group-key', true],
            ['/c/smart-collection', true],
            ['/ko/c/smart-collection', true],
            ['/map', true],
            ['/ko/map', true],
            ['/', false],
            ['/ko', false],
            ['/timeline', false],
        ] as const;

        for (const worker of WORKER_CLASSIFIERS) {
            for (const [pathname, expected] of cases) {
                expect(worker.classify(pathname), `${worker.label} classifier for ${pathname}`).toBe(expected);
            }
        }
    });

    it('bypasses unlocalized and localized admin routes', () => {
        const adminFn = TEMPLATE.slice(
            TEMPLATE.indexOf('function isAdminRoute'),
            TEMPLATE.indexOf('function isImageDerivative'),
        );
        expect(adminFn).toMatch(/\^\\\/admin/);
        expect(adminFn).toMatch(/\^\\\/\[a-z\]\{2\}/);
        expect(adminFn).toMatch(/\^\\\/api\\\/admin/);
    });

    it('classifies root and locale-prefixed upload derivatives identically', () => {
        const imageFn = TEMPLATE.slice(
            TEMPLATE.indexOf('function isImageDerivative'),
            TEMPLATE.indexOf('function isHtmlRoute'),
        );
        expect(imageFn).toContain('uploads\\/(?:avif|webp|jpeg)');
        expect(imageFn).toContain('(?:[a-z]{2}(?:-[A-Z]{2})?\\/)?');
        expect(imageFn).not.toContain("pathname.startsWith('/uploads/avif/')");
    });
});

describe('sw.template.js LRU accounting parity with lib/sw-cache.ts (TEST-R4C6-11 / C4-02)', () => {
    it('recordAndEvict pays the tracked total down UNCONDITIONALLY (phantom entries must not evict real ones)', () => {
        // C4-02 / DBG4-02 (run-10 c4): the prior `if (deleted) { total -= }`
        // shape let browser-quota-evicted phantom entries pin un-payable
        // bytes in the walk's total, forcing eviction of genuinely-cached
        // fresh entries. The decrement must be unconditional.
        const fnIdx = TEMPLATE.indexOf('async function recordAndEvict');
        const fnEnd = TEMPLATE.indexOf('async function', fnIdx + 1);
        const fn = TEMPLATE.slice(fnIdx, fnEnd);
        expect(fn).toMatch(/await imageCache\.delete\(entry\.url\);/);
        expect(fn).toMatch(/total -= entry\.size;\s*\n\s*entries\.delete\(entry\.url\);/);
        expect(fn).not.toMatch(/if \(deleted\) \{\s*\n\s*total -= entry\.size;/);
    });

    // AGG-H3 (run-6 cycle-2): lock the head-walk-no-sort eviction + the
    // delete-then-set recency upsert so the optimization can't silently
    // regress back to the O(n log n) Array.from(...).sort() shape.
    it('recordAndEvict evicts via insertion-order head-walk, not a sort', () => {
        const fnIdx = TEMPLATE.indexOf('async function recordAndEvict');
        const fnEnd = TEMPLATE.indexOf('async function', fnIdx + 1);
        const fn = TEMPLATE.slice(fnIdx, fnEnd);
        // No sort in the eviction path.
        expect(fn).not.toMatch(/\.sort\(/);
        // Upsert is delete-then-set so Map order tracks recency.
        expect(fn).toMatch(/entries\.delete\(url\);\s*\n\s*entries\.set\(url,/);
        // Eviction iterates the Map values directly (head-walk).
        expect(fn).toMatch(/for \(const entry of entries\.values\(\)\)/);
    });

    it('touchMeta repositions the entry (delete-then-set) so head-walk recency holds', () => {
        const fnIdx = TEMPLATE.indexOf('async function touchMeta');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = TEMPLATE.slice(fnIdx, TEMPLATE.indexOf('async function', fnIdx + 1));
        expect(fn).toMatch(/entries\.delete\(url\);\s*\n\s*entries\.set\(url,/);
    });

    it('serializes metadata mutations so concurrent cache writes cannot drop entries', () => {
        expect(TEMPLATE).toContain('let metaMutationQueue = Promise.resolve();');
        expect(TEMPLATE).toContain('metaMutationQueue = run.catch(() => {});');
        expect(TEMPLATE).toMatch(/async function recordAndEvict\(url, newSize\) \{\s*\n\s*return withMetaMutation\(async \(\) => \{/);
        expect(TEMPLATE).toMatch(/async function touchMeta\(url, knownSize, resolveSize\) \{\s*\n\s*return withMetaMutation\(async \(\) => \{/);
        expect(TEMPLATE).toMatch(/async function deleteMeta\(url\) \{\s*\n\s*return withMetaMutation\(async \(\) => \{/);
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

    // C2-11 (run-10 c2): a confirmed-fresh 304 must serve the cached
    // Response AS-IS — no local body rewrite (no imageCache.put), just a
    // meta-only recency touch. Rebuilding + re-putting identical bytes on
    // every confirmed-fresh view was the PERF-01 finding.
    it('the 304 branch serves cached with a metadata touch and no body rewrite', () => {
        const fn = imageFn();
        const head304 = fn.indexOf("head.status === 304");
        expect(head304).toBeGreaterThan(-1);
        const branchEnd = fn.indexOf('return cached;', head304);
        expect(branchEnd).toBeGreaterThan(head304);
        const branch = fn.slice(head304, branchEnd);
        expect(branch).toMatch(/touchMeta\(/);
        expect(branch).not.toMatch(/refreshCachedImageTimestamp/);
        expect(branch).not.toMatch(/imageCache\.put\(/);
        expect(branch).not.toMatch(/startRevalidate\(/);
    });

    it('a 200 HEAD with the same ETag serves cached with no body rewrite', () => {
        const fn = imageFn();
        const headFetch = fn.indexOf('const head = await fetch(request.url');
        const firstHeadStatusBranch = fn.indexOf('if (head.status === 304)');
        const cachedSizeDeclaration = fn.indexOf("const cachedSize = Number(cached.headers.get('Content-Length')) || 0;");
        const sameEtag = fn.indexOf('networkEtag && networkEtag === cachedEtag');
        expect(headFetch).toBeGreaterThan(-1);
        expect(firstHeadStatusBranch).toBeGreaterThan(headFetch);
        expect(cachedSizeDeclaration).toBeGreaterThan(headFetch);
        expect(cachedSizeDeclaration).toBeLessThan(firstHeadStatusBranch);
        expect(sameEtag).toBeGreaterThan(-1);
        const branchEnd = fn.indexOf('return cached;', sameEtag);
        expect(branchEnd).toBeGreaterThan(sameEtag);
        const branch = fn.slice(sameEtag, branchEnd);
        expect(branch).toMatch(/touchMeta\(/);
        expect(branch).not.toMatch(/refreshCachedImageTimestamp/);
        expect(branch).not.toMatch(/imageCache\.put\(/);
        expect(branch).not.toMatch(/startRevalidate\(/);
    });

    it('the generated sw.js serves cached on same-ETag 200 HEAD without a body rewrite', () => {
        const fnIdx = GENERATED_SW.indexOf('async function staleWhileRevalidateImage');
        const htmlIdx = GENERATED_SW.indexOf('async function networkFirstHtml');
        const fn = GENERATED_SW.slice(fnIdx, htmlIdx);
        const sameEtag = fn.indexOf('networkEtag && networkEtag === cachedEtag');
        expect(sameEtag).toBeGreaterThan(-1);
        const branchEnd = fn.indexOf('return cached;', sameEtag);
        const branch = fn.slice(sameEtag, branchEnd);
        expect(branch).toMatch(/touchMeta\(/);
        expect(branch).not.toMatch(/refreshCachedImageTimestamp/);
        expect(branch).not.toMatch(/imageCache\.put\(/);
        expect(branch).not.toMatch(/startRevalidate\(/);
    });

    it('refreshCachedImageTimestamp no longer exists in the template or generated worker (C2-11)', () => {
        expect(TEMPLATE).not.toMatch(/refreshCachedImageTimestamp/);
        expect(GENERATED_SW).not.toMatch(/refreshCachedImageTimestamp/);
    });

    it('touchMeta never grows a tracked size (no eviction trigger)', () => {
        const fnIdx = TEMPLATE.indexOf('async function touchMeta');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = TEMPLATE.slice(fnIdx, TEMPLATE.indexOf('async function', fnIdx + 1));
        expect(fn).toMatch(/existing && existing\.size \? existing\.size : knownSize/);
        expect(fn).not.toMatch(/recordAndEvict/);
    });

    // C3-10 (run-10 c3) + C4-42 (run-10 c4): the meta timestamp is the SOLE
    // recency authority after C2-11, so the touch must stay LIFETIME-COVERED —
    // but not gate the response. Both confirmed-fresh branches route the touch
    // through extendLifetime(event, ...) (event.waitUntil when available,
    // inline-await fallback), so SW termination cannot drop the write AND a
    // warm masonry paint no longer serializes tile responses behind the
    // global meta-mutation queue. A bare fire-and-forget touch remains
    // forbidden.
    it('both confirmed-fresh branches keep the recency touch lifetime-covered without gating the response (template + generated)', () => {
        for (const src of [TEMPLATE, GENERATED_SW]) {
            const matches = src.match(/await extendLifetime\(event, touchMeta\(request\.url, cachedSize, \(\) => responseSize\(cached\)\)\);/g) ?? [];
            expect(matches.length).toBe(2);
            expect(src).not.toMatch(/^\s*touchMeta\(request\.url/m);
            // The helper itself must waitUntil when an event exists and fall
            // back to returning the guarded promise (inline await) otherwise.
            expect(src).toMatch(/function extendLifetime\(event, promise\) \{/);
            expect(src).toMatch(/event\.waitUntil\(guarded\);/);
        }
    });

    // C4-08 / PERF4-02 (run-10 c4): the HTML network-first strategy must
    // return the network response immediately — the put + eviction walk ride
    // event.waitUntil so first-paint/HTML streaming is never gated on the
    // full download + storage write. The body tee (clone) stays synchronous.
    it('networkFirstHtml backgrounds the cache put via extendLifetime and passes the event through the fetch handler', () => {
        for (const src of [TEMPLATE, GENERATED_SW]) {
            const htmlFn = src.slice(
                src.indexOf('async function networkFirstHtml'),
                src.indexOf("self.addEventListener('install'"),
            );
            expect(htmlFn).toMatch(/async function networkFirstHtml\(request, event\)/);
            expect(htmlFn).toMatch(/void extendLifetime\(/);
            expect(htmlFn).not.toMatch(/await htmlCache\.put\(request, responseToCache\);\s*\n\s*await evictHtmlCacheIfNeeded\(\);\s*\n\s*\}\s*\n\s*return networkResponse;/);
            expect(src).toMatch(/event\.respondWith\(networkFirstHtml\(request, event\)\)/);
            expect(src).toMatch(/event\.respondWith\(staleWhileRevalidateImage\(request, event\)\)/);
        }
    });

    // C4-26 / TRC4-08 (run-10 c4): the eviction-decision meta READ must go
    // through the mutation queue so it cannot race a queued touch write.
    it('evictExpiredCachedImage reads recency through the meta-mutation queue', () => {
        for (const src of [TEMPLATE, GENERATED_SW]) {
            expect(src).toMatch(/async function readMetaForUrl\(url\) \{\s*\n\s*return withMetaMutation\(/);
            expect(src).toMatch(/const metaEntry = await readMetaForUrl\(url\);/);
        }
    });

    // PERF3-03 / C3-22 (run-10 c3): touchMeta must skip (not record) a
    // size-0 entry after failing to resolve the body size — a 0-size record
    // occupies Cache storage invisibly to the MAX_IMAGE_BYTES walk.
    it('touchMeta resolves an unknown size lazily and never records size 0', () => {
        for (const src of [TEMPLATE, GENERATED_SW]) {
            const fnIdx = src.indexOf('async function touchMeta');
            expect(fnIdx).toBeGreaterThan(-1);
            const fn = src.slice(fnIdx, src.indexOf('async function', fnIdx + 1));
            expect(fn).toMatch(/if \(!size && typeof resolveSize === 'function'\)/);
            expect(fn).toMatch(/if \(!size\) \{\s*\n\s*return;/);
        }
    });

    it('cache-miss and ETag-mismatch paths still await the network response', () => {
        const fn = imageFn();
        expect(fn).toMatch(/const fresh = await startRevalidate\(\);/);
        expect(fn).toMatch(/const response = await startRevalidate\(\);/);
    });

    it('uses Content-Length for image sizing before falling back to blob buffering', () => {
        const sizeFnIdx = TEMPLATE.indexOf('async function responseSize');
        expect(sizeFnIdx).toBeGreaterThan(-1);
        const sizeFn = TEMPLATE.slice(sizeFnIdx, TEMPLATE.indexOf('async function staleWhileRevalidateImage', sizeFnIdx));
        expect(sizeFn).toContain("response.headers.get('Content-Length')");
        expect(sizeFn).toMatch(/Number\.isFinite\(parsed\) && parsed >= 0/);
        expect(sizeFn).toMatch(/return \(await response\.clone\(\)\.blob\(\)\)\.size;/);
        expect(imageFn()).toMatch(/const size = await responseSize\(networkResponse\);/);
    });

    // AGG-R8c3-11/TEST-3 (run-8 c3): the synchronous HEAD ETag probe MUST be
    // bounded by AbortSignal.timeout so a slow/hung network does not stall the
    // warm-cache masonry paint per tile (AGG-R8-05). The reference
    // lib/sw-cache.ts does NOT implement HEAD probing, so the template is the
    // ONLY copy of this logic — dropping the signal would silently regress the
    // bound with a green suite. Pin the bounded HEAD on the probe fetch.
    it('the HEAD ETag probe is bounded by AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)', () => {
        const fn = imageFn();
        // The HEAD probe fetch must carry both method: 'HEAD' and the abort signal.
        const headIdx = fn.indexOf("method: 'HEAD'");
        expect(headIdx).toBeGreaterThan(-1);
        // The signal must appear within the same fetch options object (a small
        // window after the method key).
        const optionsWindow = fn.slice(headIdx, headIdx + 200);
        expect(optionsWindow).toMatch(/signal:\s*AbortSignal\.timeout\(HEAD_REVALIDATE_TIMEOUT_MS\)/);
        // The timeout constant is defined (and small — a few hundred ms).
        expect(TEMPLATE).toMatch(/const HEAD_REVALIDATE_TIMEOUT_MS\s*=\s*\d{2,4};/);
    });

    it('the generated sw.js carries the same bounded HEAD probe as the template', () => {
        expect(GENERATED_SW).toMatch(/signal:\s*AbortSignal\.timeout\(HEAD_REVALIDATE_TIMEOUT_MS\)/);
        expect(GENERATED_SW).toMatch(/const HEAD_REVALIDATE_TIMEOUT_MS\s*=\s*\d{2,4};/);
    });

    it('stamps image cache entries and expires unverified stale derivatives via meta-first age (C2-11)', () => {
        const fn = imageFn();
        expect(TEMPLATE).toMatch(/const IMAGE_MAX_STALE_MS\s*=\s*60 \* 60 \* 1000;/);
        expect(TEMPLATE).toMatch(/function responseWithCacheTimestamp\(response\)/);
        expect(TEMPLATE).toMatch(/headers\.set\('sw-cached-at', String\(Date\.now\(\)\)\)/);
        expect(fn).toMatch(/imageCache\.put\(cacheKey, responseWithCacheTimestamp\(networkResponse\)\)/);
        expect(TEMPLATE).toMatch(/function cachedImageAge\(response\)/);
        expect(TEMPLATE).toMatch(/return Infinity;/);
        // The meta store is now the primary age source: evictExpiredCachedImage
        // reads getMeta() first and only falls back to cachedImageAge(cached)
        // (the sw-cached-at header) when no meta entry exists.
        const evictFnIdx = TEMPLATE.indexOf('async function evictExpiredCachedImage(imageCache, cacheKey, url, cached)');
        expect(evictFnIdx).toBeGreaterThan(-1);
        const evictFn = TEMPLATE.slice(evictFnIdx, TEMPLATE.indexOf('async function staleWhileRevalidateImage'));
        // C4-26 (run-10 c4): the read now goes through the mutation queue via
        // readMetaForUrl (still meta-first, header only as fallback).
        expect(evictFn).toMatch(/const metaEntry = await readMetaForUrl\(url\);/);
        expect(evictFn).toMatch(/metaEntry && Number\.isFinite\(metaEntry\.timestamp\)\s*\n\s*\? Date\.now\(\) - metaEntry\.timestamp\s*\n\s*: cachedImageAge\(cached\)/);
        expect(TEMPLATE).toMatch(/age > IMAGE_MAX_STALE_MS/);
        expect(TEMPLATE).toMatch(/await imageCache\.delete\(cacheKey\);\s*\n\s*await deleteMeta\(url\);/);
        const expiryIdx = fn.indexOf('evictExpiredCachedImage(imageCache, cacheKey, request.url, cached)');
        expect(expiryIdx).toBeGreaterThan(-1);
        const expiryBranch = fn.slice(expiryIdx, expiryIdx + 260);
        expect(expiryBranch).toMatch(/const fresh = await startRevalidate\(\);/);
        expect(expiryBranch).toMatch(/return fresh \?\? new Response\('Network error', \{ status: 503 \}\);/);
    });

    it('generated sw.js carries image stale-expiry stamping and meta-first age from the template', () => {
        expect(GENERATED_SW).toMatch(/const IMAGE_MAX_STALE_MS\s*=\s*60 \* 60 \* 1000;/);
        expect(GENERATED_SW).toMatch(/headers\.set\('sw-cached-at', String\(Date\.now\(\)\)\)/);
        expect(GENERATED_SW).toMatch(/imageCache\.put\(cacheKey, responseWithCacheTimestamp\(networkResponse\)\)/);
        expect(GENERATED_SW).toMatch(/evictExpiredCachedImage\(imageCache, cacheKey, request\.url, cached\)/);
        expect(GENERATED_SW).toMatch(/const metaEntry = await readMetaForUrl\(url\);/);
    });

    it('evicts stale derivative cache entries when the server returns 404 or 410', () => {
        const fn = imageFn();
        expect(TEMPLATE).toMatch(/async function deleteMeta\(url\)/);
        expect(fn).toMatch(/networkResponse\.status === 404 \|\| networkResponse\.status === 410/);
        expect(fn).toMatch(/await imageCache\.delete\(cacheKey\);\s*\n\s*await deleteMeta\(request\.url\);/);
        expect(fn).toMatch(/head\.status === 404 \|\| head\.status === 410/);
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
