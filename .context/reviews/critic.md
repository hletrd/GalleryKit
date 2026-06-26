# Critic Review — Cycle 15 (GalleryKit, HEAD 2f886351)

**Agent:** critic (opus) · **Angle:** skeptical multi-perspective critique; "fixed one sibling, missed the next" pattern hunt; doc/code coherence.

**One-line summary:** Mature codebase, all cycle-14 fixes verified individually correct; the disk-check, SIGTERM/SIGINT, and COLOR_IMPACTING_KEYS surfaces are genuinely unified — but the recurring "fixed one sibling, missed the next" theme persists in TWO new places: admin-only `bit_depth`/`icc_profile_name` reads left nullness-guarded while siblings were explicitly `isAdmin`-gated, and a reactions-removal migration that never actually executes on any database while a test rationalizes the gap on a false premise.

**VERDICT: ACCEPT-WITH-RESERVATIONS** — no CRITICAL/HIGH/MEDIUM; two NEW LOW latent inconsistencies + two INFO notes.

## Pre-commitment predictions vs actual
- Third statfs/disk-check site missed → **WRONG** (only 2 sites, both `bavail`; restore path deliberately has no pre-check; fully unified).
- Next still races on SIGINT → **WRONG** (`start-server.js:388-390` guards BOTH SIGINT+SIGTERM on `NEXT_MANUAL_SIG_HANDLE`; both suppressed).
- COLOR_IMPACTING_KEYS missing a byte-impacting setting → **WRONG** (all 9 present; the 3 excluded don't change bytes).
- Other admin-only fields read without `isAdmin` → **RIGHT** (`bit_depth`, `icc_profile_name`).
- Migration runbook drift → **RIGHT** (reactions orphan, different mechanism than expected).
- CLAUDE.md line-cite drift → on-disk doc well-maintained for everything checked (the injected context was stale vs HEAD; real file correct).

---

## Finding 1 — Reactions-removal cleanup never executes on any DB; guarding test rationalizes the gap on a false premise — LOW, Confidence HIGH
- `apps/web/drizzle/0014_drop_reactions.sql` (`DROP TABLE IF EXISTS image_reactions; ALTER TABLE images DROP COLUMN IF EXISTS reaction_count;`) is **orphaned** — NOT in `_journal.json` (the `0014` slot is `0014_add_icc_profile_name`). Drizzle iterates the journal, so this file is **never applied**.
- `0007_image_reactions.sql` (idx 7, IS in journal) creates `image_reactions` + `images.reaction_count`.
- `migrate.js reconcileLegacySchema` drops `entitlements` + `images.license_tier` (~621-628) — the paid-downloads removal was mirrored — but `grep -c reaction migrate.js` = **0**: the reactions removal was NOT mirrored.
- `migration-journal.test.ts:29-32` knows about the orphan and permits it ("out-of-band cleanup … this orphan is allowed"). The premise is **false** — no out-of-band mechanism exists; reconcile doesn't drop it and drizzle doesn't run it.

**Failure scenario:** Any DB that ran the old drizzle path (executed `0007`) — including the legacy-migrated production DB — permanently retains a dead `image_reactions` table + dead `images.reaction_count int NOT NULL DEFAULT 0`. The intended cleanup looks done (file named `0014_drop_reactions`) but silently never ran — the exact "silent migration skip" class the runbook exists to prevent. No functional/security impact; a coherence defect + a test teaching the wrong thing.

**Fix:** mirror the entitlements pattern in `reconcileLegacySchema` (`dropTableIfPresent('image_reactions')` + `dropColumnIfPresent('images','reaction_count')`); correct the `migration-journal.test.ts:29-32` comment; optionally delete the orphaned `.sql`.

## Finding 2 — `bit_depth` and `icc_profile_name` left nullness-guarded while 6+ siblings are explicitly `isAdmin`-gated — LOW, Confidence HIGH
The cycle-13/14 "missed sibling" pattern one field-tier deeper. Both are admin-only (`data.ts` `PrivacySensitiveKeys`). The explicit-gate convention IS established (`color_space` :458, `was_downscaled` :479, `matrix_coefficients` :449, `transfer_function` :402, `color_pipeline_decision` :408, `has_gain_map` :582) but the two missed: `icc_profile_name` (`:233` derived, rendered `:369`/`:383`) and `bit_depth` (`:469`; also `info-bottom-sheet.tsx:442`). Clipboard `copyData` (`:274,281`; `lightbox-color-pip.tsx:93,100`) folds both in ungated. No leak today (data-layer omission), defense-in-depth only — but a genuine incoherent invariant. ICC name is the most sensitive (custom-monitor profiles embed identifying strings).
**Fix:** `iccName = isAdmin ? (image.icc_profile_name || '') : ''`; `{isAdmin && image.bit_depth != null && image.bit_depth > 0 && …}`; `info-bottom-sheet.tsx:442` likewise; gate clipboard keys; add a regex lock to `color-details-section-delivered.test.ts`.

## INFO (risks needing validation, not scheduled-fix-grade)
- **Startup signal-handler window now uncovered.** `instrumentation.ts` registers SIGTERM/SIGINT only AFTER 3 awaits; with Next's handlers suppressed by `NEXT_MANUAL_SIG_HANDLE`, a SIGTERM during that boot window hits no handler → Node default-terminates. Benign today (empty view buffer at startup, idempotent queue claim). NEW gap created by the cycle-14 suppression; worth one line of awareness.
- **Shutdown no longer drains in-flight HTTP, and structurally cannot** (`register()` has no HTTP-server handle). Documented tradeoff (Dockerfile comment + cycle-14 plan). Consistent with "flush then exit promptly."
- **Could not validate against live prod DB** whether `image_reactions`/`reaction_count` physically present (read-only review). A `SHOW TABLES LIKE 'image_reactions'` at next deploy confirms Finding 1's footprint.

## Verified correct (not re-litigated)
Disk-check unification (2 sites, both `bavail`); SIGINT+SIGTERM both suppressed by the env var; `data.ts` `currentFlushPromise` in-flight-await logic (always resolved+nulled in `finally`, bounded by 15s race — no hang); COLOR_IMPACTING_KEYS completeness (9 keys) + `_ColorKeysAreSettingKeys` guard; icc-extractor `mluc dataSize<16` localized correctly; journal monotonicity idx≥18 test-locked; new cycle-14 tests non-vacuous; on-disk CLAUDE.md accurate.
