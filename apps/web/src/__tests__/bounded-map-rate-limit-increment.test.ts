/**
 * R16C16 TE-16-01: lock the BoundedMap rate-limit increment pattern.
 *
 * `BoundedMap.get()` returns a SHALLOW COPY (`{ ...value }`), so the pre-R15C15
 * `entry.count++` mutated the discarded copy and the stored counter never
 * advanced — the in-memory fast-path limit could never fire. R15C15 CR-15-01
 * replaced the mutate-the-copy increment with a fresh object written via
 * `.set()` (`const next = { count: entry.count + 1, ... }; map.set(key, next)`).
 *
 * That fix had ZERO test coverage: reverting any of the three files to
 * `entry.count++` passed every test (the sharing/admin-users limits still held
 * via their DB-backed second layer; embeddings has NO fallback). This
 * source-contract test makes a revert fail at `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SITES: ReadonlyArray<readonly [name: string, relPath: string]> = [
    ['sharing.ts', '../app/actions/sharing.ts'],
    ['admin-users.ts', '../app/actions/admin-users.ts'],
    ['embeddings.ts', '../app/actions/embeddings.ts'],
];

/** Strip // line and block comments so a literal in an explanatory comment
 *  (e.g. "the pre-fix `entry.count++`") cannot satisfy or break the scan. */
function stripJsComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('BoundedMap rate-limit increment pattern (R16C16 TE-16-01 / R15C15 CR-15-01)', () => {
    it.each(SITES)('increments via an immutable { count: entry.count + 1 } write (%s)', (_name, relPath) => {
        const code = stripJsComments(readFileSync(resolve(__dirname, relPath), 'utf8'));
        // The fix shape: a fresh object carrying the incremented count.
        expect(code).toMatch(/count:\s*entry\.count\s*\+\s*1/);
    });

    it.each(SITES)('does NOT mutate the discarded shallow copy with entry.count++ (%s)', (_name, relPath) => {
        const code = stripJsComments(readFileSync(resolve(__dirname, relPath), 'utf8'));
        // A revert to `entry.count++` (or `entry.count += 1`) would silently
        // freeze the in-memory counter at 1 — BoundedMap.get() returns a copy.
        expect(code).not.toMatch(/entry\.count\s*\+\+/);
        expect(code).not.toMatch(/entry\.count\s*\+=/);
    });
});
