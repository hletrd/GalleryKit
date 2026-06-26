/**
 * plan-315 item 14 / ARCH-R5C1-04 (pulled forward this cycle as AGG-R5C3
 * escalation TEST-R5C3-02): migration-journal monotonicity + tag↔file guard.
 *
 * WHY THIS EXISTS — the burned-once production failure mode (documented in
 * CLAUDE.md "Migration & Schema-Drift Runbook"): the Drizzle MySQL migrator
 * decides whether to apply a journal entry purely by
 * `lastDbMigration.created_at < migration.folderMillis` against
 * MAX(created_at). A new journal entry whose `when` is BELOW the current max is
 * SILENTLY SKIPPED — every deploy logs "Migration Complete" while the schema
 * never advances. A hand-written stale `when` (copy-paste, wrong clock) is the
 * exact mistake that left production months behind on the color/HDR columns.
 *
 * This test catches that mistake at `npm test` / commit time instead of at the
 * next production deploy:
 *   (1) `when` strictly increases for every entry with idx >= 7;
 *   (2) every journal `tag` has a matching `drizzle/<tag>.sql` file.
 *
 * GRANDFATHERED INVERSION (idx 6 -> 7): the journal carries a historical
 * non-monotonic step — idx 6 (0006_admin_tokens, when 1778304060000) is FOLLOWED
 * by idx 7 (0007_image_reactions, when 1746144000000), a ~1-year backward jump.
 * The reconcile/baseline path in migrate.js already absorbed this (it baselines
 * by per-entry HASH, not by the max-when cursor), so it is frozen history, not a
 * live bug. The monotonicity assertion therefore starts at idx 7 — every entry
 * FROM idx 7 forward must strictly increase, which is where all NEW migrations
 * land. Adding a new migration with a `when` <= the current global max would fail
 * assertion (1) here.
 *
 * ORPHAN SQL FILE: `drizzle/0014_drop_reactions.sql` has NO journal entry (the
 * 0014 slot is 0014_add_icc_profile_name), so drizzle never applies it. The
 * authoritative drop of the dead image_reactions table + images.reaction_count
 * column lives in migrate.js `reconcileLegacySchema` (R15C15 Critic-F1), mirroring
 * the entitlements/license_tier removal — that is the mechanism that actually
 * cleans up a legacy-migrated DB. The .sql file is retained as documentation but
 * is inert. The tag->file direction (every journal tag has a .sql) is asserted;
 * the file->tag direction is NOT, so this orphan is allowed.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const drizzleDir = path.resolve(__dirname, '..', '..', 'drizzle');
const journalPath = path.join(drizzleDir, 'meta', '_journal.json');

interface JournalEntry {
    idx: number;
    tag: string;
    when: number;
}

function loadJournal(): JournalEntry[] {
    const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
    return raw.entries;
}

/** idx at and after which `when` MUST strictly increase (the grandfathered 6->7 inversion is excluded). */
const MONOTONIC_FROM_IDX = 7;

describe('drizzle migration journal integrity', () => {
    it('has sequential idx values starting at 0', () => {
        const entries = loadJournal();
        expect(entries.length).toBeGreaterThan(0);
        entries.forEach((e, i) => {
            expect(e.idx, `journal entry at position ${i} has idx ${e.idx}, expected ${i}`).toBe(i);
        });
    });

    it('`when` strictly increases for every entry from idx 7 forward', () => {
        const entries = loadJournal();
        const tail = entries.filter((e) => e.idx >= MONOTONIC_FROM_IDX).sort((a, b) => a.idx - b.idx);
        for (let i = 1; i < tail.length; i++) {
            const prev = tail[i - 1];
            const cur = tail[i];
            expect(
                cur.when,
                `migration journal monotonicity broken: ${cur.tag} (idx ${cur.idx}, when ${cur.when}) is NOT strictly greater than ${prev.tag} (idx ${prev.idx}, when ${prev.when}). ` +
                    `Drizzle would SILENTLY SKIP it — use Date.now() at commit time so the new when exceeds the global max. See CLAUDE.md Migration & Schema-Drift Runbook.`,
            ).toBeGreaterThan(prev.when);
        }
    });

    it('every entry from idx 18 forward exceeds the global-max `when` of all prior entries (no stale-clock regressions)', () => {
        const entries = loadJournal().sort((a, b) => a.idx - b.idx);
        // idx 18 (0018_has_gain_map) is the first entry AFTER the post-inversion
        // tail (idx 7-17, all in the 1746-1747M band) climbs back above the
        // pre-inversion max (idx 6 = 1778304060000). From idx 18 forward the
        // journal is once again globally monotonic, so EVERY new migration must
        // beat the running max of everything before it — exactly the invariant the
        // drizzle MAX(created_at) cursor enforces. This is the assertion a future
        // hand-written stale `when` (the burned-once failure) trips.
        const GLOBAL_MONOTONIC_FROM_IDX = 18;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e.idx < GLOBAL_MONOTONIC_FROM_IDX) continue;
            const priorMax = Math.max(...entries.slice(0, i).map((x) => x.when));
            expect(
                e.when,
                `${e.tag} (idx ${e.idx}) when=${e.when} must exceed the global max of all prior entries (${priorMax}) or drizzle silently skips it`,
            ).toBeGreaterThan(priorMax);
        }
    });

    it('every journal tag has a matching drizzle/<tag>.sql file', () => {
        const entries = loadJournal();
        for (const e of entries) {
            const sqlPath = path.join(drizzleDir, `${e.tag}.sql`);
            expect(fs.existsSync(sqlPath), `journal tag "${e.tag}" (idx ${e.idx}) has no matching ${e.tag}.sql`).toBe(true);
        }
    });

    it('journal tags are unique', () => {
        const entries = loadJournal();
        const tags = entries.map((e) => e.tag);
        expect(new Set(tags).size, 'duplicate journal tag detected').toBe(tags.length);
    });
});
