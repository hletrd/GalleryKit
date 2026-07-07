# Debugger Review - Cycle 15

Date: 2026-07-07 KST
Reviewer lane: debugger
Scope: whole-repository latent bug and failure-mode review, with emphasis on null/edge-state bugs, async hazards, race windows, restore/upload failures, data inconsistency, path handling, and UI runtime errors.

Constraints honored: review-only; no application source, database, service, commit, push, or deploy changes. The only write in this lane is this review artifact.

## Inventory And Coverage

Required instructions read before reviewing:

- `AGENTS.md`
- `CLAUDE.md`, focused on architecture, security, restore/race protections, schema/migration rules, image pipeline, semantic-search activation, deployment/runtime topology, and test/quality-gate sections
- `.context/reviews/prompts/common_review_scope.md`
- `.context/reviews/prompts/debugger.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory built first:

- Full source inventory: 617 files under `apps/web/src`.
- Debugger-relevant runtime inventory: 316 files across server actions, API routes, core libraries, schema/migrations/scripts, app routes/pages/components, and e2e/test surfaces used as regression evidence.
- Server actions examined: `admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`.
- API routes examined: admin DB download, Lightroom upload, health/live, OG image routes, semantic search, similar search, and upload-serving routes.
- Core library surfaces examined: DB pool, restore maintenance, durable restore marker, admin mutation barrier, upload-processing contract lock, background DB write drain, maintenance scheduler, pending session revocations, upload tracker, upload paths/storage, image queue, image processing, topic-image processing, data access, rate limits, API auth/admin tokens, audit logging, gallery config, CLIP/semantic helpers, smart collections, and feed/SEO helpers.
- Data/schema/deploy surfaces examined: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, Drizzle SQL/journal metadata, Docker/deploy/runtime entry points, and backup/restore scripts.
- UI runtime surface examined: locale app routes/pages plus reusable components under `apps/web/src/components`, with static sweeps for browser globals, unsafe HTML, date/JSON parsing, effect cleanup, non-null assertions, and route parameter assumptions.
- Regression evidence reviewed from tests where relevant, but tests and comments were not treated as proof of correctness without matching source behavior.

No relevant file category in this inventory was intentionally skipped. High-risk files were read directly; broad UI and test surfaces were covered by full-file inventories plus targeted static sweeps for debugger-specific failure modes.

## Confirmed Issues

### DBG15-01 - In-app color backfill trigger bypasses the restore foreground-mutation barrier

Severity: High
Confidence: High

Files/regions:

- `apps/web/src/app/actions/admin-backfill.ts:32-61`
- `apps/web/src/lib/admin-mutation-barrier.ts:15-29`
- `apps/web/src/app/[locale]/admin/db-actions.ts:497-531`
- Comparison path with the expected pattern: `apps/web/src/app/actions/embeddings.ts:59-70`

Why this is a problem:

`triggerBackfill()` is a mutating admin action: it calls `triggerAdminBackfill()` to start the in-app color-pipeline backfill and then writes an `admin_backfill_triggered` audit row. It performs only same-origin and admin checks. It does not call `getRestoreMaintenanceMessage(...)`, and it never holds `acquireAdminMutationSlot()` for the duration of the action.

That breaks the restore design documented in `admin-mutation-barrier.ts`: every foreground admin mutation admitted before the durable restore marker flips must hold a shared slot so `restoreDatabase()` can drain it before import. `restoreDatabase()` explicitly depends on that contract at `db-actions.ts:520-531`; actions without a slot are invisible to `drainAdminMutationsForRestore()`.

Concrete failure scenario:

1. An admin clicks the in-app color backfill trigger while another admin starts a DB restore.
2. `triggerBackfill()` passes its entry checks before the restore marker flips, but it does not acquire a mutation slot.
3. The backfill runner returns quickly, or returns `queued` with zero candidates and releases its backfill lock, while the server action is still before or inside the audit write at `admin-backfill.ts:51-60`.
4. The restore sets durable maintenance, drains all registered foreground mutation slots, sees none for this action, and proceeds with the import.
5. The untracked action can then write its audit event, or complete a trigger based on pre-restore state, after the restore has replaced tables. That is the exact post-restore write race the foreground barrier was added to prevent.

Suggested fix:

Give `triggerBackfill()` the same restore fence shape used by other mutating admin actions:

- Check `getRestoreMaintenanceMessage(t('restoreInProgress'))` immediately after translations and before same-origin/admin work returns success.
- Hold `using mutationSlot = acquireAdminMutationSlot();` across the whole trigger/audit body, returning `restoreInProgress` when acquisition fails.
- Keep `getBackfillStatus()` read-only and exempt.

The embedding backfill action at `apps/web/src/app/actions/embeddings.ts:59-70` is the closest local template.

## Likely Issues

None found beyond the confirmed restore-barrier gap above.

## Risks Requiring Manual Validation

- I did not run the full quality gate suite in this review-only lane. If DBG15-01 is fixed, validate with targeted server-action tests plus the standard gates: lint, API auth/origin/rate-limit linters, typecheck, build, and unit tests.
- I did not run a live MySQL restore drill. The finding is source-confirmed from the missing barrier call and restore drain contract, but the exact timing window should be covered by a regression test rather than manual timing.

## Revalidated Non-Findings

- Prior cycle DB child-process watchdog finding: no longer active. Timeout handling now lives in `apps/web/src/lib/db-child-watchdog.ts`, and behavioral tests cover SIGTERM/SIGKILL sequencing.
- Prior cycle DB pool init-timeout finding: no longer active. `apps/web/src/db/index.ts` destroys a connection that times out during initialization instead of releasing it back to the pool, and the regression test asserts `destroy()`.
- Browser and Lightroom uploads: rejected as current findings. Both paths use restore-maintenance checks, admin mutation slots where applicable, upload-processing contract locks, tracker claim/settlement, late restore checks, disk cleanup, and queue handoff safeguards.
- Backup/restore/import: rejected as an additional finding. The reviewed path uses DB restore advisory locks, durable maintenance, upload/backfill locks, SQL scanning, child-process watchdogs, bounded drains, and post-restore migration assertions.
- Image queue and processing: rejected as current findings. Queue bootstrap, retry, permanent failure persistence, per-image locks, delete-during-processing cleanup, derivative backup/restore, and shutdown/restore drains are present.
- Public expensive endpoints: rejected as current findings. Semantic/similar search, OG routes, public search/load-more, and share view writes use validation and rate-limit pre-increment or bounded background-write tracking.
- Upload path traversal/symlink escape: rejected as current findings. Upload serving and storage helpers validate top-level directories, path segments, realpaths, lstat/symlink state, extensions, and original-file privacy boundaries.
- Schema/migration drift: rejected as current findings. Current schema, migration journal, and `reconcileLegacySchema()` were checked for the latest image/settings/semantic/feed columns and indexes; the migrator includes committed-hash postconditions.
- UI browser-global/runtime hazards: rejected as current findings. Static sweeps found browser APIs inside client components/effects/handlers or guarded script injection paths, with no unguarded server-render browser global use in the reviewed app/component surface.

## Final Missed-Issue Sweep

Final sweeps covered:

- restore admission, durable marker state, foreground mutation drain, background DB write drain, maintenance sweeps, upload queue quiescence, pending session revocations, and lock release ordering;
- browser upload, Lightroom upload, topic/tag/share/settings/user/token/image mutations, audit side effects, and same-origin/admin guard placement;
- public route validation, rate limiting, cache headers, ETags, OG rendering, semantic/similar search, and public data privacy projections;
- filesystem path validation, temp-file cleanup, original/derivative isolation, delete/retry behavior, and queue recovery;
- migration journal ordering, schema reconciliation, current Drizzle schema, baseline/hash assertions, and deploy/runtime cleanup assumptions;
- UI runtime patterns for date/JSON parsing, client/server boundaries, browser globals, effect cleanup, non-null assertions, and unsafe HTML.

No relevant file in the debugger inventory was skipped. The only concrete latent failure mode found is DBG15-01.
