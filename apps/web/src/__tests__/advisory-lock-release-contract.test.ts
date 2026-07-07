import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * C7-02 (run-10 cycle 7b) source contract: every POOLED advisory-lock release
 * must go through the shared destroy-don't-release helper
 * (`@/lib/advisory-lock-release`). A failed RELEASE_LOCK on a connection that
 * is then release()d back to the pool leaks the advisory lock onto a live
 * pooled session — for fail-fast locks (GET_LOCK(...,0), e.g. the DB-restore
 * lock) one transient failure wedges the whole feature until process restart.
 *
 * This scan makes a 9th divergent raw call site a hard test failure instead
 * of a silent regression (the fix pattern previously landed at ONE site and
 * missed ~8 structurally identical siblings — cycle-7b aggregate C7-02).
 */

// Allowlisted raw `SELECT RELEASE_LOCK(?)` call sites:
// - advisory-lock-release.ts: the helper itself.
// - single-writer-guard.ts: dedicated NON-pool connection
//   (mysql.createConnection); its lifecycle closes the socket on failure,
//   which frees the lock server-side — the pool-poisoning hazard does not
//   apply.
// - scripts/backfill-clip-embeddings.ts / scripts/backfill-color-pipeline.ts:
//   sidecar `--rm` processes that exit immediately after the release; process
//   exit closes every connection, so a failed release cannot outlive the run.
const ALLOWED = new Set([
    'src/lib/advisory-lock-release.ts',
    'src/lib/single-writer-guard.ts',
    'scripts/backfill-clip-embeddings.ts',
    'scripts/backfill-color-pipeline.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            walk(full, out);
        } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('pooled advisory-lock release source contract (C7-02)', () => {
    it('finds no raw RELEASE_LOCK query call outside the allowlisted files', () => {
        const appRoot = path.resolve(__dirname, '..', '..');
        const roots = [path.join(appRoot, 'src'), path.join(appRoot, 'scripts')];
        const offenders: string[] = [];
        for (const root of roots) {
            for (const file of walk(root)) {
                const rel = path.relative(appRoot, file).split(path.sep).join('/');
                if (ALLOWED.has(rel)) continue;
                const source = fs.readFileSync(file, 'utf8');
                // Match the actual SQL string literal used at query call
                // sites repo-wide; prose comments never carry the `(?)`.
                if (source.includes('RELEASE_LOCK(?)')) {
                    offenders.push(rel);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps every allowlisted file real (an allowlist entry for a deleted file must be pruned)', () => {
        const appRoot = path.resolve(__dirname, '..', '..');
        for (const rel of ALLOWED) {
            expect(fs.existsSync(path.join(appRoot, rel)), `${rel} should exist`).toBe(true);
        }
    });
});
