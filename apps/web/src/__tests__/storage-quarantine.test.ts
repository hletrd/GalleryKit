/**
 * R14C14 / A14-02: fail-loud guard for the `lib/storage` quarantine.
 *
 * `@/lib/storage` is an internal storage-backend abstraction that is NOT yet
 * wired into the upload/processing/serving pipeline. CLAUDE.md documents it as
 * quarantined ("the @/lib/storage module still exists as an internal
 * abstraction … the product currently supports local filesystem storage only").
 * Today that quarantine is enforced by PROSE + reviewer memory only — nothing in
 * CI fails if a future action does `import { getStorage } from '@/lib/storage'`.
 *
 * That would be a real hazard: `getStorage()` returns a working
 * `LocalStorageBackend`, so the import compiles and "works", silently
 * establishing a SECOND, unaudited write path parallel to the real
 * `uploadImages`/`process-image` pipeline — diverging on path-traversal/symlink
 * hardening, ETag/settings-hash invalidation, and the GPS-strip step.
 *
 * This test statically scans every source file under `src/` (excluding the
 * `lib/storage/` module itself and `__tests__/`) and asserts NONE imports
 * `@/lib/storage` (exact, or a `@/lib/storage/...` subpath) or a relative path
 * that resolves into `lib/storage`. Import classification uses the TypeScript AST
 * (static, dynamic `import()`, and `import x = require()` forms) so a comment or
 * string mentioning the path does not false-positive.
 *
 * RE-OPEN / DELETE CRITERION: when the storage backend is INTENTIONALLY wired
 * into the upload/serve pipeline (a deliberate product decision per CLAUDE.md),
 * delete or relax this guard in the same change that does the integration.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const srcRoot = path.resolve(__dirname, '..');
const STORAGE_DIR = path.resolve(srcRoot, 'lib/storage');

/** True when an absolute path is inside src/lib/storage/. */
function isInsideStorageDir(abs: string): boolean {
    const rel = path.relative(STORAGE_DIR, abs);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Extract every module specifier (static/dynamic/require) from a source. */
function extractImportSpecifiers(source: string): string[] {
    const sf = ts.createSourceFile('m.tsx', source, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TSX);
    const specs: string[] = [];
    const push = (s: string) => specs.push(s);

    const visit = (node: ts.Node): void => {
        // import … from '…';  /  import '…';  /  export … from '…';
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            push(node.moduleSpecifier.text);
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            push(node.moduleSpecifier.text);
        }
        // dynamic import('…')
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            push(node.arguments[0].text);
        }
        // import x = require('…')
        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            push(node.moduleReference.expression.text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return specs;
}

/** Does this specifier (from `fromFile`) target the lib/storage module? */
function targetsStorage(spec: string, fromFile: string): boolean {
    // Alias form: @/lib/storage exact OR @/lib/storage/<subpath>.
    if (spec === '@/lib/storage' || spec.startsWith('@/lib/storage/')) return true;
    // Relative form: resolve against the importing file's directory and check
    // whether it lands inside src/lib/storage/.
    if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(fromFile), spec);
        if (resolved === STORAGE_DIR || isInsideStorageDir(resolved)) return true;
    }
    return false;
}

function listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === 'node_modules') continue;
            out.push(...listFilesRecursive(p));
        } else if (e.isFile() && /\.(tsx|jsx|ts|js|mts|cts)$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

function relFromSrc(abs: string): string {
    return path.relative(srcRoot, abs).replace(/\\/g, '/');
}

describe('lib/storage quarantine (A14-02)', () => {
    it('no source file outside lib/storage/ imports @/lib/storage', () => {
        const offenders: string[] = [];
        for (const file of listFilesRecursive(srcRoot)) {
            if (isInsideStorageDir(file)) continue; // the module may import itself
            let source: string;
            try {
                source = fs.readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            for (const spec of extractImportSpecifiers(source)) {
                if (targetsStorage(spec, file)) {
                    offenders.push(`${relFromSrc(file)} imports '${spec}'`);
                }
            }
        }

        expect(
            offenders,
            `lib/storage is quarantined (not wired into the upload/serve pipeline). Wiring it in is a deliberate product decision — when you do, update CLAUDE.md and this guard in the SAME change:\n\n${offenders.join('\n')}`,
        ).toEqual([]);
    });

    it('the quarantine scan is non-vacuous (the storage module exists)', () => {
        // Guards against a broken scan (wrong root / predicate) passing vacuously:
        // the module must exist on disk for the import-guard above to be meaningful.
        const indexExists = ['index.ts', 'index.tsx', 'index.js'].some((f) =>
            fs.existsSync(path.join(STORAGE_DIR, f)),
        );
        expect(indexExists, 'expected src/lib/storage/index.* to exist').toBe(true);
    });
});
