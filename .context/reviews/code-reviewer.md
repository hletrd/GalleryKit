# Code Reviewer - cycle 9

**Date:** 2026-06-29
**HEAD reviewed:** `adb1ae67204a364a7ad6c9a9cd6398aeed39151b` (`adb1ae67 build(pwa): refresh service worker version`)
**Role:** code-reviewer
**Scope:** whole current repository inventory with deep code-quality, logic, SOLID/maintainability, state-consistency, race-condition, error-handling, and cross-file contract review. Source code and plans were not edited.

## Required Context Read

- Read `AGENTS.md` first.
- Read `CLAUDE.md` for architecture, security, migration, deploy, upload, queue, restore, privacy, and review conventions.
- Loaded the local `code-review` skill instructions before reviewing.

## Inventory Built Before Findings

Review-relevant tracked surface, excluding `node_modules`, build outputs, coverage, screenshots/fixtures, and generated local artifacts:

- 557 review-relevant files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, `docs`, and `scripts`.
- Extension mix: 411 `ts`, 103 `tsx`, 27 `sql`, 5 `json`, 4 `mjs`, 3 `js`, 2 `sh`, 2 `md`.
- Runtime app: Next.js app routes, API routes, server actions, shared components, admin/public surfaces, i18n provider usage, service worker/cache helpers.
- Core data and state: `data.ts`, `data-timeline.ts`, `smart-collections.ts`, schema, migrations, migration journal, migration/reconcile scripts, analytics, privacy field contracts.
- Mutations and trust boundaries: auth/session/admin-users, admin tokens, upload/browser/LR ingest, image delete/bulk edit/retry, tags, topics, sharing, settings, SEO, embeddings, public actions.
- Processing and background work: upload path handling, process-image/topic-image, image queue, queue shutdown, backfill runner, restore maintenance, DB restore, advisory locks.
- Serving and public reads: upload serving, OG/photo OG, feed/sitemap, semantic/similar search, public pages, map/timeline/topic/smart collection routes.
- Config/docs/tests: package scripts, Next/Vitest/Playwright/ESLint config, Docker/deploy/nginx surfaces, scanner tests and lint-gate scripts, prior review aggregate/current cycle lineage enough to avoid stale duplicate findings.

Broad sweeps included route/action auth gates, mutating action origin gates, public mutating route rate-limit gates, raw SQL uses, advisory locks, detached/background work, cleanup/finally paths, upload/restore temp files, privacy-sensitive select fields, JSON-LD/HTML injection surfaces, file serving path traversal, schema/journal drift, TODO/FIXME/high-risk catch sites, and prior-cycle false positives.

## Findings

### Confirmed Issues

#### CR9-CQ-01 - `setTopicMapVisible` trusts a compile-time boolean on a runtime server-action boundary

**File/region:** `apps/web/src/app/actions/topics.ts:594-614`; backing column at `apps/web/src/db/schema.ts:4-12`; caller at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:66` and `:244-245`.

**Severity:** Medium
**Confidence:** High
**Classification:** Confirmed issue

**Issue:** `setTopicMapVisible(topicSlug: string, mapVisible: boolean)` validates the slug but never validates `mapVisible` before writing it to `topics.map_visible` and logging it. TypeScript only protects the normal in-repo caller; the server action remains a runtime boundary and can receive malformed serialized data. This is inconsistent with nearby action hardening such as `bulkUpdateImages`, which validates nested runtime payload shape before reading or writing values.

**Concrete failure scenario:** A malformed admin client, stale bundled UI, or crafted same-origin authenticated server-action request sends `"false"`, `"1"`, `null`, or an object for `mapVisible`. The action reaches `.set({ map_visible: mapVisible })` and either lets MySQL/Drizzle coerce a non-boolean into the tinyint-backed boolean column or throws a generic failure. Because this flag is the explicit opt-in for public GPS map exposure, an invalid payload can silently flip or fail the privacy gate instead of being rejected before persistence. The exact coercion behavior should be validated against the production driver, but the missing runtime guard is source-confirmed.

**Suggested fix:** Add a fail-closed guard immediately after auth/origin checks:

```ts
if (typeof mapVisible !== 'boolean') return { error: t('invalidInput') };
```

Then add a focused action test that passes malformed non-boolean values and asserts no update/audit call is made.

#### CR9-CQ-02 - DB restore temp dump can survive validation/read exceptions after upload is saved

**File/region:** `apps/web/src/app/[locale]/admin/db-actions.ts:434-493`, `:499-585`.

**Severity:** Low
**Confidence:** High
**Classification:** Confirmed issue

**Issue:** `runRestore` writes the uploaded SQL dump to a mode-0600 temp file, but cleanup after the successful write is distributed across expected validation branches and the mysql child-process close/error handlers. There is no outer `try/finally` covering the header read, `fs.stat`, scan open/read loop, DB-env validation, and child-process setup. If one of those operations throws before reaching a branch that explicitly unlinks, the promise rejects and the temp SQL dump remains in `os.tmpdir()`.

**Concrete failure scenario:** An admin uploads a restore file; `pipeline` succeeds at `db-actions.ts:437-439`. Then `fs.open(tempPath, 'r')`, `fs.stat(tempPath)`, `fs.open` for the scan, or `scanFd.read` throws due to `EMFILE`, transient disk I/O, permissions, or a host-level temp directory issue. The exception bypasses the explicit invalid-header/dangerous-SQL/missing-env unlinks and never reaches the child-process close handler. A plaintext DB dump remains on disk until manual cleanup or host temp purging. Mode `0600` limits exposure, but this is still avoidable sensitive-data retention.

**Suggested fix:** Wrap the entire post-write restore flow in a single cleanup owner, for example a `let tempUnlinked = false` helper plus `finally { if (!tempUnlinked) await fs.unlink(tempPath).catch(() => {}) }`. The child-process branch can still unlink on close, but cleanup should be idempotent and guaranteed for every thrown validation/setup path.

### Likely Issues

#### CR9-CQ-03 - `bulkUpdateImages` reports requested IDs, not existing or changed rows

**File/region:** `apps/web/src/app/actions/images.ts:940-963`, `:1024-1037`, `:1091-1103`, `:1120-1134`; contrast with stale-ID handling in `apps/web/src/app/actions/tags.ts:304-343`.

**Severity:** Low
**Confidence:** Medium
**Classification:** Likely issue

**Issue:** `bulkUpdateImages` validates that IDs are positive integers, but it does not verify that all selected images still exist before applying scalar updates, tag inserts/removals, audit logging, and success reporting. It returns `count: ids.length` regardless of how many rows were actually updated or linked. This differs from `batchAddTags`, which pre-selects existing image IDs and warns about missing images before inserting links.

**Concrete failure scenario:** Admin A opens the dashboard and selects 20 images. Admin B deletes 3 of them before Admin A submits a scalar-only bulk edit, such as clearing descriptions or changing topic. The update at `images.ts:1035-1037` affects only 17 rows, but the action logs all 20 requested IDs and returns `{ success: true, count: 20 }`; the UI shows a 20-image success toast. With tag additions, stale IDs can be silently skipped by `INSERT IGNORE` FK behavior just as `tags.ts:304-307` warns, while the bulk edit path still reports the requested count.

**Suggested fix:** Inside the transaction, select existing IDs with `inArray(images.id, ids)` before any mutation. Use that canonical set for scalar updates, tag insert values, tag removals, audit metadata, and the returned count. If some requested IDs are missing, return a warning/count consistent with `batchAddTags`, or fail the operation if partial success is not desired.

### Risks Needing Manual Validation

- **CR9-RISK-01:** For `CR9-CQ-01`, manually validate the exact Drizzle/mysql2/MySQL coercion for non-boolean values written through a boolean column. The source bug is the missing guard; the production failure mode determines whether this should be treated as privacy-impacting or generic invalid-input hardening.
- **CR9-RISK-02:** For `CR9-CQ-02`, validate host temp-dir retention behavior and permissions in production. The file is created with `0600`, so the risk is primarily same-user/process/ops exposure and disk hygiene rather than cross-user world-readable leakage.

## False Positives / Already Fixed

- **FP-CR9-01:** The previous tag-filter state split is fixed. Current `HomeClient` passes canonical `currentTags` into `TagFilter` (`home-client.tsx:271-273`), and `TagFilter` uses that prop for active state and URL construction (`tag-filter.tsx:10-45`).
- **FP-CR9-02:** The cycle-8 hardcoded retry error string is fixed. `retryFailedImage` now returns `t('imageNotInFailedState')` at `apps/web/src/app/actions/images.ts:1182-1184`.
- **FP-CR9-03:** Browser upload, Lightroom upload, retry, bootstrap, and internal queue re-enqueue settings wiring were re-checked against the cycle-8 focus. The current enqueue sites forward or reload the processing snapshot as intended; no third settings-bypass consumer was found.
- **FP-CR9-04:** Admin API exports are wrapped with `withAdminAuth`, mutating server actions call `requireSameOriginAdmin`, and public mutating API routes carry rate-limit helpers or documented exemptions. I did not find a current gate bypass.
- **FP-CR9-05:** Public upload serving is already hardened against traversal and symlink swaps via safe segment validation, directory/extension matching, `lstat`, `realpath`, root containment, conditional ETags, and abort cleanup in `serve-upload.ts`.
- **FP-CR9-06:** Privacy-sensitive public selects remain guarded by omit objects/type guards/tests, and the public map path joins only `topics.map_visible = true` plus a runtime GPS leak assertion.
- **FP-CR9-07:** Upload quota preclaim/settle, restore maintenance guards, queue quiesce, and post-restore migration flow were checked. I did not find a live rollback/lock leak in those paths beyond the temp-file cleanup gap reported as `CR9-CQ-02`.

## Final Missed-Issue Sweep

Final sweep covered:

- All review-relevant file inventory and extension/category counts.
- App routes/actions, admin/public API routes, server actions, route scanners, action-origin scanner, public mutating route scanner, auth/session/token helpers, rate limits, and same-origin/proxy handling.
- Core data access, pagination/cursors, tag/topic/share state, public map/timeline/search/smart collection data flows, JSON-LD and OG rendering surfaces.
- Upload/browser/LR ingest, original-file storage, derivative serving, process-image, topic-image processing, image queue, shutdown, restore, backfill, advisory locks, and temp-file cleanup paths.
- Schema/migrations/journal/reconcile script, privacy field contracts, generated/current docs, deploy helper constraints, and prior review aggregate to avoid stale re-reports.
- High-risk pattern greps for raw SQL, child processes, HTML injection, unguarded mutations, broad catches, TODO/FIXME, environment/config assumptions, and stale deferred issues.

Files intentionally excluded from deep manual reading:

- `node_modules`, `.next`, coverage/test output, binary images, screenshots, generated local artifacts, and historical archived review screenshots.
- Historical `.context/reviews/archive/**` and completed old plan artifacts except where needed for current-lineage false-positive checks.

## Validation Evidence

- Static review only; no source or plan files were edited.
- Report artifact written to `.context/reviews/code-reviewer.md`.
- Evidence gathered with `rg --files`, `rg` sweeps, `nl -ba` line inspections, package/config reads, current HEAD checks, and cross-file tracing.
- I did not run full lint/typecheck/build/test because this lane requested review findings only and no executable source changed.

## Recommendation

**REQUEST CHANGES** for `CR9-CQ-01` and `CR9-CQ-02`; treat `CR9-CQ-03` as a low-severity consistency fix or add an explicit product decision that bulk edits are allowed to report requested counts under concurrent deletion.
