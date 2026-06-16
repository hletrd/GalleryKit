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
 *
 * AGG-C5-01 (run-6 c5): the `import 'server-only'` sentinel alone leaves the
 * data/persistence layer UNCOVERED. The data layer (`@/db`, `@/lib/data`,
 * `@/lib/gallery-config`, …) carries no `server-only` marker, so the most
 * probable accidental leak — a future `import { getImageCached } from
 * '@/lib/data'` added to a `'use client'` component — would pass this test
 * GREEN (the `@/lib/data → @/db` chain contains no sentinel) and may not even
 * fail `next build` cleanly. We therefore ALSO treat a `mysql2` / `mysql2/promise`
 * import anywhere in the closure as a server-only-equivalent signal: that is the
 * unambiguous server-only Node driver `@/db/index.ts` imports, it can never run
 * in a browser bundle, and matching the specifier is far less brittle than
 * enumerating internal `@/db`/`@/lib/data` path names (and auto-covers any future
 * data module that imports the driver directly).
 *
 * The closure walk follows VALUE imports only — `import type … from '…'` AND the
 * inline `import { type X } from '…'` form are erased by the compiler and never
 * enter any bundle. The data layer is reached from the client today ONLY via
 * those erased forms (`home-client.tsx` / `load-more.tsx` /
 * `analytics-client.tsx` all `import { type … } from '@/lib/…'`), which is safe.
 * Import classification is done with the TypeScript AST (the same compiler API
 * the lint-gate scripts use), NOT a regex, because a regex cannot distinguish an
 * all-inline-`type` named import from one carrying a real value binding.
 *
 * Why `@/db/index.ts` does NOT itself carry `import 'server-only'` (and must not
 * be "simplified" into doing so): the real `server-only@0.0.1` export map throws
 * from its `default` condition (`index.js`) and is a no-op only under the
 * `react-server` condition (`empty.js`). Plain Node / tsx resolves `default`, so
 * `import 'server-only'` THROWS under tsx. `@/db/index.ts` is imported under tsx
 * by the documented production color-pipeline backfill sidecar
 * (`scripts/backfill-color-pipeline.ts` → `await import('../src/db')`) and by the
 * DB init/seed scripts; marking it `server-only` would break that operational
 * tooling at runtime. The `mysql2`-in-closure check below closes the same gap
 * with zero runtime risk.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

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

/**
 * Extract all `@/lib` and `@/db` VALUE static-import specifiers from a source,
 * using the TypeScript AST (the same compiler API the lint-gate scripts use)
 * rather than a regex.
 *
 * AGG-C5-01: type-only imports are ERASED by the TypeScript compiler and never
 * pull the target module into any bundle, so they must NOT be followed when
 * walking the client bundle's import closure. A regex cannot reliably tell a
 * value import from a type-only one because BOTH the statement form
 * (`import type { X } from '…'`) AND the inline form
 * (`import { type X, type Y } from '…'`) erase — and the data layer is reached
 * from the client today ONLY via these erased forms (`home-client.tsx`,
 * `load-more.tsx`, `analytics-client.tsx` all `import { type … } from '@/lib/…'`).
 * A VALUE import of the same module would be the real leak this walk exists to
 * catch. We therefore parse each import/export declaration and keep the
 * specifier only when it contributes a real runtime binding:
 *   - side-effect import (`import '@/x'`)           → value (kept)
 *   - default / namespace import                    → value (kept)
 *   - named import with ≥1 non-type specifier        → value (kept)
 *   - `import type …` (statement-level type-only)    → erased (dropped)
 *   - named import where EVERY specifier is `type`   → erased (dropped)
 *   - `export … from '@/x'` re-export (non-type-only)→ value (kept)
 */
function extractAliasedImports(source: string): string[] {
    const sf = ts.createSourceFile('m.tsx', source, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TSX);
    const specs: string[] = [];

    const isAliased = (spec: string): boolean => spec.startsWith('@/lib') || spec.startsWith('@/db');

    for (const stmt of sf.statements) {
        // import … from '…';  AND  import '…';
        if (ts.isImportDeclaration(stmt)) {
            const mod = stmt.moduleSpecifier;
            if (!ts.isStringLiteral(mod) || !isAliased(mod.text)) continue;
            const clause = stmt.importClause;
            // Side-effect-only import (no clause) pulls the module for its effects.
            if (!clause) { specs.push(mod.text); continue; }
            // `import type …` — whole statement erased.
            if (clause.isTypeOnly) continue;
            // `import Default, …` or `import * as ns` — value binding.
            if (clause.name) { specs.push(mod.text); continue; }
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings)) { specs.push(mod.text); continue; }
            if (bindings && ts.isNamedImports(bindings)) {
                // Keep only if at least one specifier is NOT inline-`type`.
                const hasValueSpecifier = bindings.elements.some((el) => !el.isTypeOnly);
                if (hasValueSpecifier) specs.push(mod.text);
                continue;
            }
            // Unknown clause shape — be conservative and follow it.
            specs.push(mod.text);
            continue;
        }
        // export … from '…';  (re-export — pulls the module unless type-only)
        if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
            const mod = stmt.moduleSpecifier;
            if (!ts.isStringLiteral(mod) || !isAliased(mod.text)) continue;
            if (stmt.isTypeOnly) continue;
            const exportClause = stmt.exportClause;
            if (exportClause && ts.isNamedExports(exportClause)) {
                const hasValueSpecifier = exportClause.elements.some((el) => !el.isTypeOnly);
                if (hasValueSpecifier) specs.push(mod.text);
                continue;
            }
            // `export * from '@/x'` (no clause) — value re-export.
            specs.push(mod.text);
            continue;
        }
    }

    // AGG-C6-02 (DBG-C6-01): the top-level statement loop above only handles
    // `ImportDeclaration` / `ExportDeclaration`. Two additional VALUE-import
    // forms can pull a server-only module into a client bundle and are NOT
    // top-level import statements, so they are missed unless we descend the
    // full AST:
    //   1. dynamic `import('@/lib/data')` — a CallExpression with the `import`
    //      keyword (the natural code-split for a heavy server/data module).
    //   2. `import db = require('@/db')` — an ImportEqualsDeclaration.
    // Both ALWAYS pull the module as a value (there is no type-only dynamic
    // import or type-only import-equals-require), so any aliased specifier is a
    // value edge. Walk every node, not just top-level statements.
    const visit = (node: ts.Node): void => {
        // dynamic `import('…')`
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0]) &&
            isAliased(node.arguments[0].text)
        ) {
            specs.push(node.arguments[0].text);
        }
        // `import x = require('…')`
        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression) &&
            isAliased(node.moduleReference.expression.text)
        ) {
            specs.push(node.moduleReference.expression.text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    // De-dupe (a module reachable via both a static and a dynamic import edge
    // should appear once).
    return [...new Set(specs)];
}

function hasServerOnlyImport(source: string): boolean {
    return /\bimport\s+['"`]server-only['"`]/.test(source);
}

/**
 * AGG-C5-01: a `mysql2` / `mysql2/promise` import is an unambiguous server-only
 * signal (native Node DB driver — cannot run in a browser bundle). Treated as
 * server-only-equivalent so the `@/lib/data → @/db → mysql2` leak vector that
 * the bare `server-only` sentinel misses is caught. Matches both
 * `import ... from 'mysql2'` / `'mysql2/promise'` and side-effect
 * `import 'mysql2'`, but NOT longer names like `mysql2-foo` (specifier is
 * anchored to a quote or a `/promise` suffix + closing quote).
 */
function hasServerOnlyDriverImport(source: string): boolean {
    return /\b(?:import|export)\b[^'"`;]*?['"`]mysql2(?:\/promise)?['"`]/.test(source);
}

function reachesServerOnly(source: string): boolean {
    return hasServerOnlyImport(source) || hasServerOnlyDriverImport(source);
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
        // transitive dependency carrying server-only (or the mysql2 driver,
        // AGG-C5-01) is the real bug.
        if (file !== entry && reachesServerOnly(source)) {
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

    // AGG-C5-01: prove the widened detection is NON-VACUOUS — the persistence
    // chokepoint `@/db/index.ts` is genuinely recognized as server-only-equivalent
    // via its `mysql2/promise` import, so a future `'use client'` → `@/lib/data`
    // (→ `@/db`) leak would fail the boundary test RED. Without this pin, a
    // refactor that drops/renames the `mysql2` import (or the detection regex)
    // would silently re-open the gap the bare `server-only` sentinel never closed.
    it('@/db/index.ts is recognized as server-only-equivalent via its mysql2 driver import (AGG-C5-01)', () => {
        const dbIndex = resolveAliasedModule('@/db');
        expect(dbIndex, '@/db must resolve to an on-disk module').not.toBeNull();
        const source = fs.readFileSync(dbIndex!, 'utf8');
        // It must NOT carry the server-only marker (tsx scripts import it under the
        // throwing `default` condition — see the file docstring).
        expect(hasServerOnlyImport(source)).toBe(false);
        // …but the driver import makes it a server-only-equivalent the walk flags.
        expect(hasServerOnlyDriverImport(source)).toBe(true);
        expect(reachesServerOnly(source)).toBe(true);
    });

    it('mysql2 driver-import detection is correctly anchored (AGG-C5-01)', () => {
        // Positive: the forms that actually pull the native driver into a bundle.
        expect(hasServerOnlyDriverImport("import mysql from 'mysql2/promise';")).toBe(true);
        expect(hasServerOnlyDriverImport('import mysql from "mysql2";')).toBe(true);
        expect(hasServerOnlyDriverImport("import type { Pool } from 'mysql2';")).toBe(true);
        expect(hasServerOnlyDriverImport("import 'mysql2';")).toBe(true);
        expect(hasServerOnlyDriverImport("export { x } from 'mysql2/promise';")).toBe(true);
        // Negative: must not false-positive on longer package names or substrings.
        expect(hasServerOnlyDriverImport("import x from 'mysql2-extra';")).toBe(false);
        expect(hasServerOnlyDriverImport("import x from '@scope/mysql2';")).toBe(false);
        expect(hasServerOnlyDriverImport("// a comment mentioning mysql2")).toBe(false);
        expect(hasServerOnlyDriverImport("const s = 'connecting to mysql2 server';")).toBe(false);
    });

    // AGG-C5-01: the AST value-import classifier is the load-bearing half of the
    // widened guard — if it ever started DROPPING value imports (e.g. a refactor
    // mis-handles a clause shape), a real `'use client'` → `@/db` value leak would
    // silently pass GREEN again. These pins prove the classifier FOLLOWS value
    // imports and DROPS type-only ones, so the walk's coverage cannot regress
    // unnoticed.
    it('extractAliasedImports follows value imports and drops type-only imports (AGG-C5-01)', () => {
        // Value imports → followed (specifier returned).
        expect(extractAliasedImports("import { getImageCached } from '@/lib/data';")).toContain('@/lib/data');
        expect(extractAliasedImports("import { db } from '@/db';")).toContain('@/db');
        expect(extractAliasedImports("import defaultExport from '@/lib/data';")).toContain('@/lib/data');
        expect(extractAliasedImports("import * as data from '@/lib/data';")).toContain('@/lib/data');
        expect(extractAliasedImports("import '@/db';")).toContain('@/db'); // side-effect import
        expect(extractAliasedImports("export { db } from '@/db';")).toContain('@/db'); // value re-export
        expect(extractAliasedImports("export * from '@/lib/data';")).toContain('@/lib/data');
        // Mixed: at least one value specifier → followed.
        expect(extractAliasedImports("import { type Foo, getImageCached } from '@/lib/data';")).toContain('@/lib/data');

        // Type-only imports → dropped (erased by the compiler; never bundled).
        expect(extractAliasedImports("import type { Foo } from '@/lib/data';")).not.toContain('@/lib/data');
        expect(extractAliasedImports("import { type Foo, type Bar } from '@/lib/data';")).not.toContain('@/lib/data');
        expect(extractAliasedImports("export type { Foo } from '@/lib/data';")).not.toContain('@/lib/data');
        // The exact erased forms used by the real client components today.
        expect(extractAliasedImports("import type { ImageListCursorInput } from '@/lib/data';")).toEqual([]);
        expect(
            extractAliasedImports(
                "import { type TopPhotoRow, type CountryRow, type TimeWindow } from '@/lib/analytics-data';",
            ),
        ).toEqual([]);
    });

    it('extractAliasedImports follows dynamic import() and import-equals-require value forms (AGG-C6-02)', () => {
        // Dynamic `import('…')` is the natural code-split for a heavy server/data
        // module; it ALWAYS pulls the module as a value. A `'use client'` module
        // doing `await import('@/lib/data')` would leak the @/lib/data → @/db →
        // mysql2 chain into the client bundle, so it MUST be followed.
        expect(extractAliasedImports("const m = await import('@/lib/data');")).toContain('@/lib/data');
        expect(extractAliasedImports("import('@/db').then((m) => m.db);")).toContain('@/db');
        expect(extractAliasedImports("const { db } = await import('@/db');")).toContain('@/db');
        // Nested inside a function body (not a top-level statement) — the
        // statement loop alone would miss this; the recursive walk catches it.
        expect(
            extractAliasedImports("function load() { return import('@/lib/data'); }"),
        ).toContain('@/lib/data');

        // `import x = require('…')` is a value binding — followed.
        expect(extractAliasedImports("import db = require('@/db');")).toContain('@/db');
        expect(extractAliasedImports("import data = require('@/lib/data');")).toContain('@/lib/data');

        // Non-aliased dynamic imports are ignored (only @/lib and @/db matter).
        expect(extractAliasedImports("const x = await import('react');")).toEqual([]);
        expect(extractAliasedImports("import path = require('node:path');")).toEqual([]);

        // De-dupe: a module reachable via BOTH a static and a dynamic edge
        // appears exactly once.
        expect(
            extractAliasedImports("import { db } from '@/db';\nconst again = await import('@/db');"),
        ).toEqual(['@/db']);
    });
});
