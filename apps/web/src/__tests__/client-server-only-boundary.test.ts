/**
 * AGG-R5C3-21 (ARCH-R5C3-01): fast-loop guard for the client → server-only
 * import boundary closed by AGG-R5C2-02.
 *
 * A React `'use client'` module that transitively static-imports a file
 * containing `import 'server-only'` is a build-time failure (server-only throws
 * when bundled for the client). AGG-R5C2-02 fixed exactly this: photo-title.ts
 * (consumed by the client photo viewer) was importing the stub PREFIX constant
 * from caption-generator.ts (which is server-only), so it was re-pointed at the
 * client-safe caption-constants.ts. No fast test pinned that boundary, so it
 * could silently regress on the next refactor and only surface in a full
 * `next build`. This source-scan walks every `'use client'` module's transitive
 * `@/lib` / `@/db` static-import closure and asserts none contains
 * `import 'server-only'`.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const srcRoot = path.resolve(__dirname, '..');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * AGG-R8-01 (run-8 c2): de-flake. This scan walks the whole `src` tree and,
 * for every `'use client'` module, walks its transitive `@/lib`/`@/db` import
 * closure. Without caching, the SAME shared `@/lib` file is `readFileSync`'d
 * once per client module whose closure reaches it — on a cold/contended CI
 * runner the redundant re-reads pushed the single test past the default 15 s
 * `testTimeout` (a flake that ALSO masked any real violation behind the same
 * red). Memoize every file read into one Map keyed by absolute path, plus a
 * per-file parsed-import-spec cache, so each source is read and parsed exactly
 * once across the entire run. We also set a generous explicit per-test timeout
 * below — NOT a suppression: the assertion still runs to completion and still
 * fails on a real client→server-only leak; we are only correcting an under-
 * sized timeout that previously turned a slow-but-correct run into a false red.
 */
const readCache = new Map<string, string | null>();
function readSourceCached(file: string): string | null {
    const hit = readCache.get(file);
    if (hit !== undefined) return hit;
    let source: string | null;
    try {
        source = fs.readFileSync(file, 'utf8');
    } catch {
        source = null;
    }
    readCache.set(file, source);
    return source;
}

const importSpecCache = new Map<string, string[]>();
function extractAliasedImportsCached(file: string, source: string): string[] {
    const hit = importSpecCache.get(file);
    if (hit !== undefined) return hit;
    const specs = extractAliasedImports(source);
    importSpecCache.set(file, specs);
    return specs;
}

/** Resolve a `@/...` import specifier to an on-disk source file, or null. */
function resolveAliasedModule(spec: string): string | null {
    if (!spec.startsWith('@/')) return null;
    const rel = spec.slice(2); // strip '@/'
    const base = path.resolve(srcRoot, rel);
    // Direct file with an extension already.
    if (path.extname(base) && fs.existsSync(base)) return base;
    for (const ext of SOURCE_EXTENSIONS) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) return candidate;
    }
    // index file in a directory.
    for (const ext of SOURCE_EXTENSIONS) {
        const candidate = path.join(base, `index${ext}`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Extract all `@/lib` and `@/db` static-import specifiers from a source. */
function extractAliasedImports(source: string): string[] {
    const specs: string[] = [];
    // Matches: import ... from '@/...';  import '@/...';  export ... from '@/...';
    const re = /\b(?:import|export)\b[^'"`;]*?['"`](@\/(?:lib|db)[^'"`]*)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        specs.push(m[1]);
    }
    return specs;
}

function hasServerOnlyImport(source: string): boolean {
    return /\bimport\s+['"`]server-only['"`]/.test(source);
}

function isUseClient(source: string): boolean {
    // 'use client' must be the first statement; tolerate a leading comment/BOM.
    const head = source.replace(/^﻿/, '').trimStart();
    return /^(['"])use client\1/.test(head);
}

function listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === 'node_modules') continue;
            out.push(...listFilesRecursive(p));
        } else if (e.isFile() && /\.(tsx|jsx|ts|js)$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

/**
 * Walk the transitive `@/lib`/`@/db` static-import closure of `entry`. Returns
 * the first resolved module in the closure that contains `import 'server-only'`,
 * along with the import chain that reached it, or null if the closure is clean.
 */
function findServerOnlyInClosure(entry: string): { offender: string; chain: string[] } | null {
    const visited = new Set<string>();
    // Stack of [file, chain-of-rel-paths-that-reached-it].
    const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [relFromSrc(entry)] }];
    while (stack.length > 0) {
        const { file, chain } = stack.pop()!;
        if (visited.has(file)) continue;
        visited.add(file);
        const source = readSourceCached(file);
        if (source === null) continue;
        // The entry file itself is the 'use client' module — its OWN
        // server-only presence is impossible (build would already fail), but a
        // transitive dependency carrying server-only is the real bug.
        if (file !== entry && hasServerOnlyImport(source)) {
            return { offender: relFromSrc(file), chain };
        }
        for (const spec of extractAliasedImportsCached(file, source)) {
            const resolved = resolveAliasedModule(spec);
            if (resolved && !visited.has(resolved)) {
                stack.push({ file: resolved, chain: [...chain, relFromSrc(resolved)] });
            }
        }
    }
    return null;
}

function relFromSrc(abs: string): string {
    return path.relative(srcRoot, abs).replace(/\\/g, '/');
}

describe('client → server-only import boundary (AGG-R5C3-21)', () => {
    it("no 'use client' module transitively imports a server-only file", () => {
        const allFiles = listFilesRecursive(srcRoot);
        const clientFiles = allFiles.filter((f) => {
            const source = readSourceCached(f);
            return source !== null && isUseClient(source);
        });
        // Sanity: the codebase has client components — if this is 0 the scanner
        // is broken (wrong root / predicate) and would pass vacuously.
        expect(clientFiles.length).toBeGreaterThan(0);

        const violations: string[] = [];
        for (const cf of clientFiles) {
            const hit = findServerOnlyInClosure(cf);
            if (hit) {
                violations.push(
                    `${relFromSrc(cf)} transitively imports server-only via:\n    ${hit.chain.join('\n    → ')}\n  offender: ${hit.offender}`,
                );
            }
        }

        expect(
            violations,
            `Client components must not pull 'server-only' into their bundle:\n\n${violations.join('\n\n')}`,
        ).toEqual([]);
    }, 60_000); // AGG-R8-01: generous explicit timeout — the memoized scan runs in
    // single-digit seconds, but a cold/contended CI runner doing a full src-tree
    // walk must not false-fail against the 15 s default. The assertion is unchanged.

    it('photo-title.ts imports caption-constants (client-safe), NOT caption-generator (server-only)', () => {
        // AGG-R5C2-02 pin: the exact regression this guard exists for.
        const code = fs.readFileSync(path.resolve(srcRoot, 'lib/photo-title.ts'), 'utf8');
        expect(code).toContain("from '@/lib/caption-constants'");
        expect(code).not.toContain("from '@/lib/caption-generator'");
        // And caption-constants itself must stay client-safe (no server-only).
        const constants = fs.readFileSync(path.resolve(srcRoot, 'lib/caption-constants.ts'), 'utf8');
        expect(hasServerOnlyImport(constants)).toBe(false);
    });
});
