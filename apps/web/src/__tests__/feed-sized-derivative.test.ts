/**
 * R25-M1: Atom feed routes must select `<media:content>` filenames against
 * the LIVE admin `image_sizes` config, not against the hard-coded
 * `DEFAULT_IMAGE_SIZES` that `sizedImageFilename`'s two-arg overload
 * silently falls back to.
 *
 * Before R25-M1, both feeds called
 *   sizedImageFilename(img.filename_jpeg, 1536)
 * with no `imageSizes` argument. The helper defaulted to
 * the built-in default size list and trivially picked `1536`. After an admin
 * reconfigure that drops `1536` from `image_sizes`
 * (and a backfill that re-encodes existing photos at the new sizes),
 * every entry's `<media:content>` URL pointed at a `_1536.jpg` that did
 * not exist on disk and the RSS-reader preview silently 404'd.
 *
 * Pure source-grep fixture — no network / DB / Sharp setup required.
 * Same style as `og-photo-fallback.test.ts` (R24-M1) and the other
 * source-contract fixtures that lock the encoder-contract /
 * fallback-chain family (R21-M1 / R22-M1 / R23-M1 / R24-M1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT_FEED_PATH = resolve(
    __dirname,
    '..',
    'app',
    'feed.xml',
    'route.ts',
);
const TOPIC_FEED_PATH = resolve(
    __dirname,
    '..',
    'app',
    '[locale]',
    '(public)',
    '[topic]',
    'feed.xml',
    'route.ts',
);

const rootSource = readFileSync(ROOT_FEED_PATH, 'utf8');
const topicSource = readFileSync(TOPIC_FEED_PATH, 'utf8');

const SUITES: Array<[string, string]> = [
    ['root /feed.xml', rootSource],
    ['topic /[locale]/[topic]/feed.xml', topicSource],
];

for (const [label, source] of SUITES) {
    describe(`${label} — R25-M1 config-driven sized-derivative selection`, () => {
        it('imports findNearestImageSize from @/lib/gallery-config-shared', () => {
            expect(source).toContain("from '@/lib/gallery-config-shared'");
            expect(source).toContain('findNearestImageSize');
        });

        it('imports getGalleryConfig from @/lib/gallery-config', () => {
            expect(source).toContain("from '@/lib/gallery-config'");
            expect(source).toContain('getGalleryConfig');
        });

        it('uses XML content ETags for 304s so SEO/settings changes invalidate the feed', () => {
            expect(source).toContain('createAtomFeedEtag(xml)');
            expect(source).toContain("request.headers.get('if-none-match')");
            expect(source).toContain('isEtagMatch(ifNoneMatch, etag)');
            expect(source).toContain("'ETag': etag");
            expect(source).not.toContain('isFeedNotModified');
            expect(source).not.toContain('getFeedUpdatedAt');
        });

        it('returns 304 only from the live ETag branch and 200 with the same ETag otherwise', () => {
            const etagIndex = source.indexOf('const etag = createAtomFeedEtag(xml)');
            const matchIndex = source.indexOf('if (isEtagMatch(ifNoneMatch, etag))');
            const notModifiedIndex = source.indexOf('status: 304', matchIndex);
            const okIndex = source.indexOf('status: 200', notModifiedIndex);
            expect(etagIndex).toBeGreaterThan(-1);
            expect(matchIndex).toBeGreaterThan(etagIndex);
            expect(notModifiedIndex).toBeGreaterThan(matchIndex);
            expect(okIndex).toBeGreaterThan(notModifiedIndex);

            const notModifiedBranch = source.slice(matchIndex, okIndex);
            expect(notModifiedBranch).toContain('new NextResponse(null');
            expect(notModifiedBranch).toContain("'ETag': etag");
            const okResponseIndex = source.lastIndexOf('new NextResponse(xml', okIndex);
            expect(okResponseIndex).toBeGreaterThan(notModifiedIndex);
            const okBranch = source.slice(okResponseIndex, okIndex + 500);
            expect(okBranch).toContain('new NextResponse(xml');
            expect(okBranch).toContain("'ETag': etag");
        });

        it('picks the nearest configured size via findNearestImageSize(config.imageSizes, 1536)', () => {
            expect(source).toContain('findNearestImageSize(config.imageSizes, 1536)');
        });

        it('passes config.imageSizes as the third argument to sizedImageFilename', () => {
            expect(source).toMatch(
                /sizedImageFilename\(\s*img\.filename_jpeg\s*,\s*\w+\s*,\s*config\.imageSizes\s*\)/,
            );
        });

        it('no longer carries the bare two-arg sizedImageFilename(<…>, 1536) call shape', () => {
            // The pre-R25-M1 pattern: `sizedImageFilename(img.filename_jpeg, 1536)`
            // with no third argument silently defaulted to DEFAULT_IMAGE_SIZES.
            // Match a function call where the second arg is the literal `1536` and
            // there's no comma before the closing paren.
            expect(source).not.toMatch(
                /sizedImageFilename\(\s*img\.filename_jpeg\s*,\s*1536\s*\)/,
            );
        });

        it('resolves the size constant ONCE outside the entries.map closure', () => {
            // Pull the computed size out of the per-row map so the work is
            // not repeated for every entry. The variable is `feedJpegSize`
            // in both feed routes.
            expect(source).toContain('const feedJpegSize = findNearestImageSize(config.imageSizes, 1536)');
        });

        it('lineage comment cites R25-M1', () => {
            expect(source).toContain('R25-M1');
        });

        it('uses a non-empty feed author fallback for fresh site configs', () => {
            expect(source).toContain("seo.author.trim() || seo.title.trim() || siteConfig.title || 'GalleryKit'");
            expect(source).toContain('const feedRights = siteCopyright || `© ${new Date().getFullYear()} ${feedAuthorName}`');
            expect(source).toMatch(/feedAuthor:\s*\{\s*name: feedAuthorName,/);
        });
    });
}

describe('topic /[locale]/[topic]/feed.xml — COR-R4C18-01 locale validation', () => {
    // COR-R4C18-01: route handlers bypass BOTH the next-intl middleware
    // (proxy.ts matcher excludes every dotted path) AND the [locale]
    // layout's notFound() locale gate (layouts wrap pages, not route
    // handlers). The topic feed must therefore self-validate its locale
    // param — otherwise GET /<junk>/<topic>/feed.xml returns a 200 feed
    // whose alternate link and every entry link point at a locale prefix
    // that 404s for all subscribers, CDN-cached per arbitrary string.
    it('imports isSupportedLocale from @/lib/locale-path', () => {
        expect(topicSource).toContain('isSupportedLocale');
        expect(topicSource).toContain("from '@/lib/locale-path'");
    });

    it('rejects unsupported locales BEFORE any DB work', () => {
        const guardIndex = topicSource.indexOf('isSupportedLocale(locale)');
        expect(guardIndex).toBeGreaterThan(-1);
        // The guard must sit above every data-layer call in source order.
        for (const dbCall of ['getSeoSettings(', 'getTopicBySlug(', 'getImagesForFeed(', 'getGalleryConfig(']) {
            const callIndex = topicSource.indexOf(dbCall, topicSource.indexOf('export async function GET'));
            expect(callIndex).toBeGreaterThan(guardIndex);
        }
    });

    it('the rejection branch returns a 404', () => {
        const guardIndex = topicSource.indexOf('isSupportedLocale(locale)');
        const windowAfterGuard = topicSource.slice(guardIndex, guardIndex + 300);
        expect(windowAfterGuard).toContain('status: 404');
    });

    it('lineage comment cites COR-R4C18-01', () => {
        expect(topicSource).toContain('COR-R4C18-01');
    });
});
