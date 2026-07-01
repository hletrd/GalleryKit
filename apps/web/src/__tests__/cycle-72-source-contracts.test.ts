import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(__dirname, '..', '..');
const readApp = (rel: string) => readFileSync(resolve(appRoot, rel), 'utf8');

describe('cycle 72 restore-maintenance fail-closed and sidecar write guards', () => {
    it('durable marker reads fail closed for non-ENOENT stat errors', () => {
        const source = readApp('src/lib/restore-maintenance-durable.ts');
        expect(source).toContain('fs.statSync');
        expect(source).toContain("if (code === 'ENOENT')");
        expect(source).toContain('Failed to read restore maintenance marker; failing closed');
        expect(source).not.toContain('fs.existsSync(/* turbopackIgnore: true */ markerPath)');
    });

    it('processImageFormats exposes a final-write guard and calls it before derivative swaps', () => {
        const source = readApp('src/lib/process-image.ts');
        expect(source).toContain('export interface ProcessImageFormatsWriteGuard');
        expect(source).toContain('writeGuard?: ProcessImageFormatsWriteGuard');
        expect(source).toContain('await writeGuard?.assertWritable?.();');
        expect(source.indexOf('await writeGuard?.assertWritable?.();')).toBeLessThan(
            source.indexOf('const backupPath = await backupExistingFinalPath(outputPath);'),
        );
        expect(source).toContain('await restorePreviousFinalPaths();');
    });

    it('the color sidecar injects the durable restore assertion into processImageFormats', () => {
        const source = readApp('scripts/backfill-color-pipeline.ts');
        expect(source).toContain("{ assertWritable: () => assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME) }");
        const guardCalls = source.match(/assertNoDurableRestoreMaintenanceForScript\(SCRIPT_NAME\)/g) ?? [];
        expect(guardCalls.length).toBeGreaterThanOrEqual(5);
    });

    it('the shipped restore recovery mjs mirrors configurable durable marker paths', () => {
        const source = readApp('scripts/restore-maintenance-recovery.mjs');
        expect(source).toContain('RESTORE_MAINTENANCE_MARKER_PATH');
        expect(source).toContain('RESTORE_MAINTENANCE_DIR');
        expect(source).toContain("process.env.NODE_ENV === 'production' ? '/app/data' : 'data'");
        expect(source).toContain('fs.statSync(getMarkerLocation().path)');
    });
});

describe('cycle 72 reduced-motion contracts', () => {
    it('settings validation focus downgrades smooth scroll when reduced motion is requested', () => {
        const source = readApp('src/app/[locale]/admin/(protected)/settings/settings-client.tsx');
        expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
        expect(source).toContain("behavior: prefersReducedMotion ? 'auto' : 'smooth'");
    });

    it('photo swipe haptics are skipped when reduced motion is requested', () => {
        const source = readApp('src/components/photo-navigation.tsx');
        expect(source).toContain('const vibrateForSwipe = useCallback');
        expect(source).toContain("if (shouldReduceMotion || typeof navigator.vibrate !== 'function') return;");
        expect(source).toContain('navigator.vibrate(10)');
    });
});

describe('cycle 72 per-photo OG temporary fallback cache', () => {
    it('uses a non-cacheable policy for derivative-miss fallback redirects', () => {
        const source = readApp('src/app/api/og/photo/[id]/route.tsx');
        expect(source).toContain("const OG_TEMPORARY_FALLBACK_CACHE_CONTROL = 'no-store, no-cache, must-revalidate'");
        expect(source).toContain('return buildFallbackResponse(seo.url, OG_TEMPORARY_FALLBACK_CACHE_CONTROL');
    });
});
