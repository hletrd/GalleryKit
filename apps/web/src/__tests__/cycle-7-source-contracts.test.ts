import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (relativePath: string) => readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
const root = (relativePath: string) => readFileSync(join(process.cwd(), '..', '..', relativePath), 'utf8');
const app = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Cycle 7 upload config and queue durability contracts', () => {
    it('Docker native packages normalize OCI TARGETARCH to npm package architecture names', () => {
        const dockerfile = app('Dockerfile');

        expect(dockerfile).toContain('amd64) npm_arch="x64"');
        expect(dockerfile).toContain('arm64) npm_arch="arm64"');
        expect(dockerfile).toContain('Unsupported TARGETARCH=');
        expect(dockerfile).toContain('@img/sharp-linux-${npm_arch}@');
        expect(dockerfile).not.toMatch(/@img\/sharp(?:-libvips)?-linux-\$\{TARGETARCH/);
        expect(dockerfile).not.toMatch(/@next\/swc-linux-\$\{TARGETARCH/);
    });

    it('upload write paths use strict gallery config and persist a processing settings snapshot', () => {
        const browserUpload = src('app/actions/images.ts');
        const lrUpload = src('app/api/admin/lr/upload/route.ts');

        for (const source of [browserUpload, lrUpload]) {
            expect(source).toContain('getGalleryConfigStrict');
            expect(source).toContain('createProcessingSettingsSnapshot');
            expect(source).toContain('processing_settings_json');
            expect(source).toContain('serializeProcessingSettingsSnapshot(processingSettingsSnapshot)');
        }
    });

    it('queue bootstrap skips durable failed rows and restores processing snapshots', () => {
        const queue = src('lib/image-queue.ts');

        expect(queue).toContain('isNull(images.processing_error)');
        expect(queue).toContain('parseProcessingSettingsSnapshot(image.processing_settings_json)');
        expect(queue).toContain('applyProcessingSettingsSnapshot(job, snapshot)');
        expect(queue).toContain('processing_settings_json: null');
    });

    it('schema migration, reconcile, and privacy guards know the processing snapshot column', () => {
        const schema = src('db/schema.ts');
        const migrate = app('scripts/migrate.js');
        const data = src('lib/data.ts');
        const privacyTest = src('__tests__/privacy-fields.test.ts');
        const migration = app('drizzle/0025_processing_settings_snapshot.sql');

        for (const source of [schema, migrate, data, privacyTest, migration]) {
            expect(source).toContain('processing_settings_json');
        }
    });
});

describe('Cycle 7 image processing and CLIP contracts', () => {
    it('derivative generation uses fresh metadata width and waits for all encoders before cleanup', () => {
        const processImage = src('lib/process-image.ts');

        expect(processImage).toContain('processingBaseWidth = freshBaseWidth');
        expect(processImage).toContain('Promise.allSettled([');
        expect(processImage).toContain('PromiseRejectedResult');
    });

    it('real CLIP inference is guarded by a process-wide concurrency limiter', () => {
        const clipModel = src('lib/clip-model.ts');

        expect(clipModel).toContain('CLIP_INFERENCE_CONCURRENCY');
        expect(clipModel).toContain('withInferenceSlot');
        expect(clipModel.match(/withInferenceSlot/g)?.length).toBeGreaterThanOrEqual(3);
        expect(clipModel).toMatch(/return withInferenceSlot\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*sharp\s*\(\s*imagePath[\s\S]*new Tensor\s*\(\s*'float32'/);
    });
});

describe('Cycle 7 public UI and API contracts', () => {
    it('tag filter uses canonical currentTags supplied by the server client boundary', () => {
        const tagFilter = src('components/tag-filter.tsx');
        const homeClient = src('components/home-client.tsx');

        expect(tagFilter).toContain('currentTags = []');
        expect(tagFilter).toContain('const canonicalTags = currentTags.map');
        expect(tagFilter).not.toContain("searchParams.get('tags')");
        expect(homeClient).toContain('<TagFilter tags={tags} currentTags={currentTags} />');
    });

    it('grid surfaces use the shared delegated picture fallback boundary', () => {
        const files = [
            src('components/home-client.tsx'),
            src('app/[locale]/(public)/timeline/page.tsx'),
            src('app/[locale]/(public)/year/[year]/page.tsx'),
            src('app/[locale]/(public)/g/[key]/page.tsx'),
        ];
        const gridPicture = src('components/grid-picture.tsx');
        const boundary = src('components/grid-picture-fallback-boundary.tsx');

        expect(gridPicture).toContain('data-grid-picture');
        expect(gridPicture).not.toContain('useState');
        expect(boundary).toContain('onErrorCapture');
        for (const source of files) {
            expect(source).toContain('GridPicture');
            expect(source).toContain('GridPictureFallbackBoundary');
        }
    });

    it('semantic and similar routes report enrichment failures as HTTP errors', () => {
        const semantic = src('app/api/search/semantic/route.ts');
        const similar = src('app/api/search/similar/[id]/route.ts');

        expect(semantic).toContain("status: 503");
        expect(semantic).toContain('Search results could not be loaded');
        expect(similar).toContain("status: 503");
        expect(similar).toContain('Similar photos could not be loaded');
    });

    it('accessibility and preview fixes are present', () => {
        expect(src('components/search.tsx')).toContain('aria-hidden="true"');
        expect(src('components/nav-client.tsx')).toContain('aria-controls="primary-nav-controls"');
        expect(src('components/upload-dropzone.tsx')).toContain('decoding="async"');
    });
});

describe('Cycle 7 docs and admin navigation contracts', () => {
    it('Lightroom tokens have admin nav labels and docs point to the Tokens page', () => {
        const tokenClient = src('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');

        expect(src('components/admin-nav.tsx')).toContain("'/admin/tokens'");
        expect(app('messages/en.json')).toContain('"tokens": "Tokens"');
        expect(app('messages/ko.json')).toContain('"tokens": "토큰"');
        expect(root('CLAUDE.md')).toContain('dedicated admin Tokens page');
        expect(tokenClient).toContain("scopes: ['lr:upload']");
        expect(tokenClient).not.toContain("'lr:read'");
        expect(tokenClient).not.toContain("'lr:delete'");
        expect(tokenClient).toContain("t('lrToken.neverExpires')");
        expect(app('messages/en.json')).toContain('Upload access is granted automatically');
        expect(app('messages/en.json')).toContain('Never expires; revoke to disable');
    });

    it('fresh-install docs create a category before upload', () => {
        expect(root('README.md')).toContain('create a category, upload one photo');
        expect(app('README.md')).toContain('create a category, upload one photo');
    });
});
