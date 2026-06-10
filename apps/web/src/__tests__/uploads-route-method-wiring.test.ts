import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C3 COR-R4C3-01 / ARCH-R4C3-06 / TEST-R4C3-07.
 *
 * Lock the method pass-through contract on BOTH uploads route twins:
 *
 *   - `app/uploads/[...path]/route.ts` (primary serving path — all image
 *     URLs are root-relative `/uploads/{fmt}/...`)
 *   - `app/[locale]/(public)/uploads/[...path]/route.ts`
 *
 * `serveUploadFile(pathSegments, ifNoneMatch, method)` defaults `method`
 * to `'GET'`, and only `method === 'HEAD'` engages the R20-L1 headers-only
 * fast path (no createReadStream / fd open for a body Next.js strips
 * anyway). R20-L1 updated the locale twin but not the primary route, so
 * every Service-Worker HEAD revalidate on the primary path opened a
 * discarded file stream for 8+ cycles with no gate noticing. This
 * fixture-style test (same shape as `process-image-blur-wiring.test.ts`)
 * is the drift guard the twin pair lacked.
 */

const ROUTE_FILES = [
    path.resolve(__dirname, '..', 'app', 'uploads', '[...path]', 'route.ts'),
    path.resolve(__dirname, '..', 'app', '[locale]', '(public)', 'uploads', '[...path]', 'route.ts'),
] as const;

function readSource(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

/** Extract the body of an exported async function by name. */
function extractExportBody(source: string, name: 'GET' | 'HEAD'): string {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start, `export async function ${name} must exist`).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('export async function', start + 1);
    return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe.each(ROUTE_FILES.map((file) => [path.relative(process.cwd(), file), file] as const))(
    'uploads route method wiring: %s',
    (_label, file) => {
        // NOTE: the argument list contains a nested call —
        // `request.headers.get('if-none-match')` — so the matcher crosses
        // inner parens non-greedily and anchors on the trailing method
        // literal immediately before the closing paren.
        it('HEAD export passes \'HEAD\' through to serveUploadFile (R20-L1 fast path)', () => {
            const body = extractExportBody(readSource(file), 'HEAD');
            expect(body).toMatch(/serveUploadFile\s*\(\s*pathSegments\s*,[\s\S]*?,\s*'HEAD'\s*\)/);
        });

        it('GET export passes \'GET\' explicitly (twin symmetry, no silent default)', () => {
            const body = extractExportBody(readSource(file), 'GET');
            expect(body).toMatch(/serveUploadFile\s*\(\s*pathSegments\s*,[\s\S]*?,\s*'GET'\s*\)/);
        });

        it('GET export never passes \'HEAD\' (would suppress response bodies)', () => {
            const body = extractExportBody(readSource(file), 'GET');
            expect(body).not.toMatch(/'HEAD'/);
        });
    },
);
