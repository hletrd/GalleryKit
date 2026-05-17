import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R12-H1 / R10-L4: lock the RAW-rejection contract in process-image.ts.
 *
 * `getSafeExtension` MUST throw the structured `RawFileError` sentinel
 * (not the generic `Error`) for known camera-RAW extensions so the
 * uploadImages action can surface a specific "RAW not supported — export
 * to JPEG/TIFF/AVIF first" message rather than a generic "extension not
 * allowed" failure that the admin UI cannot distinguish from disk or
 * decode errors.
 *
 * A fixture-style source-scan test (matching the style of
 * `process-image-blur-wiring.test.ts`) keeps the contract auditable
 * even when the throw happens inside a path the test runner cannot easily
 * exercise with a real RAW file.
 */

const processImagePath = path.resolve(__dirname, '..', 'lib', 'process-image.ts');
const imagesActionPath = path.resolve(__dirname, '..', 'app', 'actions', 'images.ts');

function readSource(p: string): string {
    return fs.readFileSync(p, 'utf8');
}

describe('process-image RAW rejection contract', () => {
    it('exports a RawFileError class', () => {
        const source = readSource(processImagePath);
        expect(source).toMatch(/export\s+class\s+RawFileError\s+extends\s+Error/);
    });

    it('declares a RAW_EXTENSIONS set covering common camera vendors', () => {
        const source = readSource(processImagePath);
        // The Set literal should at minimum cover the Canon / Nikon / Sony /
        // Fuji / Olympus / Panasonic / Adobe core extensions.
        const required = ['.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2', '.dng'];
        for (const ext of required) {
            expect(source).toContain(`'${ext}'`);
        }
        expect(source).toMatch(/const\s+RAW_EXTENSIONS\s*=\s*new\s+Set\(/);
    });

    it('getSafeExtension throws RawFileError before the generic extension check', () => {
        const source = readSource(processImagePath);
        // Find the body of getSafeExtension and verify the RAW check
        // happens (a) before (b) the ALLOWED_EXTENSIONS check.
        const match = source.match(/function getSafeExtension[\s\S]*?\n}/);
        expect(match).not.toBeNull();
        const body = match![0];
        const rawIdx = body.indexOf('RAW_EXTENSIONS.has');
        const allowedIdx = body.indexOf('ALLOWED_EXTENSIONS.has');
        expect(rawIdx).toBeGreaterThan(-1);
        expect(allowedIdx).toBeGreaterThan(-1);
        expect(rawIdx).toBeLessThan(allowedIdx);
        expect(body).toMatch(/throw\s+new\s+RawFileError\(/);
    });
});

describe('uploadImages RAW handling contract', () => {
    it('imports RawFileError from process-image', () => {
        const source = readSource(imagesActionPath);
        expect(source).toMatch(/import\s*\{[^}]*\bRawFileError\b[^}]*\}\s*from\s*['"]@\/lib\/process-image['"]/);
    });

    it('catches RawFileError as a separate branch from generic failure', () => {
        const source = readSource(imagesActionPath);
        expect(source).toMatch(/instanceof\s+RawFileError/);
        expect(source).toMatch(/rawRejectedCount\+\+/);
    });

    it('surfaces rawNotSupported message when all failures are RAW', () => {
        const source = readSource(imagesActionPath);
        expect(source).toMatch(/t\(['"]rawNotSupported['"]\)/);
    });
});
