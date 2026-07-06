# Secondary Code Review (bounded replacement lane) — Run-10 Cycle 2 (2026-07-07)

Reviewer: fdr2 — time-boxed replacement for the hung `feature-dev-code-reviewer`
message-return lane. Complementary scope only (per lead): `apps/web/src/app/api/**`,
`apps/web/src/i18n/**`, `apps/web/e2e/**`, `apps/web/scripts/migrate.js`.
Cross-checked against `_aggregate.md` (C2-01 … C2-55) to avoid duplicates.

## Files examined

- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/i18n/request.ts`
- `apps/web/e2e/admin.spec.ts`, `public.spec.ts`, `origin-guard.spec.ts`,
  `not-found-status.spec.ts`, `focus-restore.spec.ts`, `nav-visual-check.spec.ts`,
  `test-fixes.spec.ts`, `helpers.ts`
- `apps/web/scripts/migrate.js`
- Supporting evidence: `apps/web/src/lib/backup-filename.ts`,
  `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`,
  `apps/web/drizzle/*.sql` (DML grep)

## Findings

### FDR-01 — Pre-baselining in `prepareLegacyDatabaseIfNeeded` means Drizzle never applies new migrations on existing DBs; migration DML is silently lost and the "fails loud" post-condition is unreachable

- **Severity:** MEDIUM-HIGH
- **Confidence:** High (mechanism verified from code; drizzle cursor semantics are quoted in the repo's own comment at `migrate.js:731-745`)
- **Location:** `apps/web/scripts/migrate.js:787-800` (`prepareLegacyDatabaseIfNeeded`), interaction with `apps/web/scripts/migrate.js:803-824` (`runMigrations`)

**Problem.** On any DB that already has gallery tables, a newly committed
migration presents exactly like legacy drift: its hash is absent from
`__drizzle_migrations`, so `journalCovered === false` and the code runs
`reconcileLegacySchema` **and then `baselineAllJournalMigrations`, which inserts
the new migration's hash row (created_at = its journal `when`) BEFORE
`migrate()` runs**. Drizzle's MySQL migrator applies an entry only when
`MAX(created_at) < folderMillis`; after the baseline insert that condition is
false for every entry. Consequences:

1. **The committed `.sql` for a new migration never executes on any deployed
   database.** `reconcileLegacySchema` is the de facto migrator everywhere (the
   fresh-DB branch acknowledges this at `migrate.js:768-784`; the legacy branch
   comment frames it as drift repair, but it swallows the normal
   new-migration-pending case too).
2. **Data-manipulation statements in migrations are silently dropped.** The
   reconcile-coverage tripwire (`migrate-reconcile-coverage.test.ts`) enforces
   mirrors for tables/columns/indexes/FKs/known DROPs only — not
   UPDATE/INSERT/DELETE backfills. Precedent exists:
   `drizzle/0001_sync_current_schema.sql:59` carries an `UPDATE` backfill (it
   happens to be hand-mirrored behind `addedPosition` in reconcile; nothing
   enforces that for the next author).
3. **The loud post-condition in `runMigrations` can structurally never fire.**
   `prepareLegacyDatabaseIfNeeded` always runs first and guarantees every
   journal hash is recorded before `migrate()` is called (early-return when
   covered; baseline-all otherwise), so `missing.length > 0` is unreachable.
   CLAUDE.md's migration runbook ("the post-condition assertion will then fail
   the next deploy" for a non-monotonic `when`) documents a safety net that is
   dead code in the current control flow.

**Failure scenario.** An author ships migration `0029` containing a data
backfill (`UPDATE images SET … WHERE …`) following the runbook: monotonic
`when`, reconcile mirror for the DDL (the coverage test demands nothing for
DML). On the next production deploy, `journalCovered` is false, reconcile runs
(no DML), `0029`'s hash is baselined, `migrate()` skips it, the post-condition
passes, and the log prints `[Migration] Complete.` — the backfill never ran and
nothing will ever flag it. Same class as the original 0011 drift incident, but
now caused by the fix's own control flow rather than the journal.

**Fix.** In `prepareLegacyDatabaseIfNeeded`, split "legacy repair" from
"pending new migrations": baseline only journal entries whose `when` is
at-or-below the current recorded cursor (`MAX(created_at)` in
`__drizzle_migrations`) — i.e. entries drizzle would wrongly skip — and leave
entries with strictly-greater `when` unrecorded so `migrate()` genuinely
applies them (SQL, including DML, executes; drizzle records the hash itself).
This also restores meaning to the `runMigrations` post-condition. If instead
the "reconcile is the sole migrator" model is the intended design, then (a)
extend the coverage tripwire to fail on any DML statement in a migration file
that lacks an explicit reconcile mirror marker, and (b) correct the CLAUDE.md
runbook claim about the post-condition.

**Aggregate cross-reference.** Related to but distinct from C2-25 (journal
`when` authoring rule) and C2-26 (reconcile hand-mirror drift): this is a
control-flow property of `prepareLegacyDatabaseIfNeeded` that makes the drizzle
apply path and the post-condition unreachable, creating the DML-loss class
neither existing finding covers.

## Verified clean (no findings)

- **API routes:** `db/download` (strict `BACKUP_FILENAME_PATTERN` blocks
  header injection into `Content-Disposition`; realpath containment + symlink
  posture correct; file-handle lifecycle correct on all branches). `lr/upload`
  (claim/settle pairing symmetric on every early return; idempotent settle;
  contract-lock released in `finally`; post-commit errors correctly return 201).
  `health` (bounded probe; race timer unref'd, no unhandled rejection).
  `og` + `og/photo` (charged/refunded rate-limit posture consistent with the
  documented SEC-R4C17-01 policy; SSRF pinning fails closed; fallback redirect
  origin-validated). `search/semantic` + `search/similar` (origin, size, and
  abort gates ordered correctly; enrichment select compile-guarded).
- **i18n:** `request.ts` validates locale against `LOCALES` before the dynamic
  import — no traversal, correct fallback.
- **e2e:** specs assert real contracts (origin guard uses a concrete route and
  rejects 404-as-pass; not-found spec pins real 404 statuses; helpers'
  session-token forgery would fail loudly on format drift). Hardcoded seed keys
  (`Abc234Def5/6`, `e2e-smoke`) are deliberate seed-lane dependencies.
