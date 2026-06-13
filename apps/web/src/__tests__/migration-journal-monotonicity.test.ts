/**
 * Run-6 Cycle 1 AGG-7 — migration journal monotonicity + post-condition guard.
 *
 * CLAUDE.md "Migration & Schema-Drift Runbook" documents a burned-once footgun:
 * the Drizzle MySQL migrator decides whether to apply each journal entry by
 * `lastDbMigration.created_at < migration.folderMillis`, i.e. a single
 * MAX(created_at) cursor — NOT per-entry hashes. The repo journal has
 * non-monotonic `when` timestamps (a block of May-2025 values sandwiched between
 * 2026 values), so a naive max-row baseline poisons the cursor and silently
 * skips every entry below it. Production sat at the post-0011 schema for months
 * with every deploy logging "Complete." and no error.
 *
 * `migrate.js` mitigates this two ways: (a) per-entry hash baselining, and (b) a
 * post-condition that throws `Drizzle silently skipped N migration(s)` when any
 * journal hash is absent from `__drizzle_migrations`. Nothing pinned either, and
 * nothing guarded the journal against a NEW non-monotonic entry — which is the
 * exact mistake CLAUDE.md's "Adding a new migration" step 2 warns against
 * ("Failing to monotonically advance `when` causes drizzle to silently skip your
 * migration").
 *
 * This fixture-style test locks all three:
 *   1. journal `when` is strictly monotonic by `idx` — EXCEPT a documented
 *      allowlist of the known historical inversions; a NEW non-monotonic entry
 *      (idx > the last allowlisted one) FAILS;
 *   2. the post-condition predicate (`expected.filter(m => !recorded.has(hash))`)
 *      correctly flags a missing hash;
 *   3. `migrate.js` still carries the loud-fail post-condition throw.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

interface JournalEntry {
    idx: number;
    tag: string;
    when: number;
}

const journal = JSON.parse(
    readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

// The DOCUMENTED historical `when` inversion in the committed journal. idx 7
// (0007_image_reactions, when=1746144000000, May 2025) drops BELOW idx 6
// (0006_admin_tokens, when=1778304060000, ~2026) — the single point where the
// adjacent-pair `when` goes backwards. idx 8-17 are a May-2025 block that is
// internally monotonic (each advances vs its immediate predecessor), and idx 18
// rises back above 2026, so only the idx-6→idx-7 step is a real inversion (see
// CLAUDE.md runbook). This is frozen history — the per-entry-hash baselining in
// migrate.js makes it safe. Any NEW entry MUST strictly advance `when` or it
// would be silently skipped. To intentionally add a known inversion, extend this
// set AND document why in CLAUDE.md.
const ALLOWLISTED_NONMONOTONIC_IDX = new Set<number>([7]);

describe('AGG-7: migration journal `when` monotonicity', () => {
    it('entries are ordered by idx', () => {
        const idxs = journal.entries.map((e) => e.idx);
        const sorted = [...idxs].sort((a, b) => a - b);
        expect(idxs).toEqual(sorted);
    });

    it('every entry strictly advances `when` vs the previous, except documented historical inversions', () => {
        const offenders: Array<{ idx: number; tag: string; when: number; prevWhen: number }> = [];
        for (let i = 1; i < journal.entries.length; i++) {
            const prev = journal.entries[i - 1]!;
            const cur = journal.entries[i]!;
            if (cur.when <= prev.when && !ALLOWLISTED_NONMONOTONIC_IDX.has(cur.idx)) {
                offenders.push({ idx: cur.idx, tag: cur.tag, when: cur.when, prevWhen: prev.when });
            }
        }
        // A non-empty list means a NEW migration was added with a `when` that does
        // not advance — drizzle will silently skip it (CLAUDE.md runbook). Fix the
        // new entry's `when` (use Date.now() at commit time) before merging.
        expect(offenders).toEqual([]);
    });

    it('the documented allowlist still corresponds to real inversions (no stale allowlist)', () => {
        // Guard against the allowlist drifting larger than reality: every
        // allowlisted idx (except the first journal entry) must ACTUALLY be a
        // non-advancing `when` vs its predecessor. If a future journal rewrite
        // makes one of these monotonic, this fails so the allowlist is trimmed.
        const byIdx = new Map(journal.entries.map((e) => [e.idx, e]));
        for (const idx of ALLOWLISTED_NONMONOTONIC_IDX) {
            const cur = byIdx.get(idx);
            if (!cur || cur.idx === 0) continue;
            const prev = byIdx.get(idx - 1);
            if (!prev) continue;
            expect(
                cur.when <= prev.when,
                `allowlisted idx ${idx} (${cur.tag}) is actually monotonic now — trim the allowlist`,
            ).toBe(true);
        }
    });
});

describe('AGG-7: migrate.js silent-skip post-condition', () => {
    it('the missing-hash predicate flags a journal entry absent from the recorded set', () => {
        // Mirror the exact predicate migrate.js uses:
        //   missing = expected.filter(m => !recordedHashes.has(m.hash))
        // so the contract is documented and a regression in its shape is caught.
        const expected = [
            { tag: '0000_a', hash: 'aaa' },
            { tag: '0001_b', hash: 'bbb' },
            { tag: '0002_c', hash: 'ccc' },
        ];
        const recorded = new Set(['aaa', 'ccc']); // 'bbb' was silently skipped
        const missing = expected.filter((m) => !recorded.has(m.hash));
        expect(missing.map((m) => m.tag)).toEqual(['0001_b']);
        expect(missing.length).toBeGreaterThan(0); // would trigger the throw
    });

    it('migrate.js still carries the loud-fail post-condition throw', () => {
        const src = readFileSync(join(process.cwd(), 'scripts/migrate.js'), 'utf8');
        // The deploy must fail loudly on a silent skip — pin the assertion's
        // presence so a future refactor cannot quietly drop it.
        expect(src).toContain('Drizzle silently skipped');
        expect(src).toMatch(/expectedMigrations\.filter\(\s*\(m\)\s*=>\s*!recordedHashes\.has\(m\.hash\)\s*\)/);
    });
});
