/**
 * R25-M1: Atom feed routes must select `<media:content>` filenames against
 * the LIVE admin `image_sizes` config, not against the hard-coded
 * `DEFAULT_IMAGE_SIZES` that `sizedImageFilename`'s two-arg overload
 * silently falls back to.
 *
 * Before R25-M1, both feeds called
 *   sizedImageFilename(img.filename_jpeg, 1536)
 * with no `imageSizes` argument. The helper defaulted to
 * `DEFAULT_IMAGE_SIZES = [640, 1536, 2048, 4096]` and trivially picked
 * `1536`. After an admin reconfigure that drops `1536` from `image_sizes`
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
    });
}
