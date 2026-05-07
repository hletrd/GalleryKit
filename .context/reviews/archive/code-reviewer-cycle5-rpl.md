# Code Reviewer — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: deep review of `apps/web/src/**`, `apps/web/scripts/**`, and related infra. I read every server-action file, data layer, image pipeline, middleware, sharing/SEO/settings actions, admin DB actions, and all in-repo unit-test surfaces. Prior cycles (cycle 4 rpl2 and earlier) already closed the HIGH/MEDIUM findings; this cycle surfaces the residual issues that remain.

## Inventory

- `apps/web/src/app/actions/` — 9 files (auth, images, topics, tags, sharing, admin-users, public, seo, settings)
- `apps/web/src/app/[locale]/admin/db-actions.ts` — backup/restore/CSV
- `apps/web/src/app/actions.ts` — barrel re-export
- `apps/web/src/lib/` — 41 helper modules
- `apps/web/src/db/` — schema + pool setup
- `apps/web/src/proxy.ts` — middleware admin guard
- `apps/web/scripts/check-action-origin.ts`, `scripts/check-api-auth.ts` — CI lint helpers
- `apps/web/src/__tests__/` — 46 vitest files
- `apps/web/e2e/` — 5 Playwright specs

Every file above was examined either directly or via its consumers.

## Findings

### C5-01 — `check-action-origin.ts` only scans `function` declarations, silently passes arrow-function exports
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/scripts/check-action-origin.ts:85-86`.
- **Evidence:** the traversal `for (const statement of sourceFile.statements) { if (!ts.isFunctionDeclaration(statement)) continue; ... }` skips `export const doThing = async () => { ... }` and `export let doThing = async function() {}`. The CI lint will report `OK` even if a future refactor converts a mutating server action to an arrow export that omits `requireSameOriginAdmin()`.
- **Why it matters:** the lint's job is to PREVENT regressions. A silent pass on a format the codebase will naturally drift toward (shadcn/ui + Radix callers already emit arrow-style factories heavily) negates the defense-in-depth guarantee this lint was created to enforce (cycle 2 `C2R-02`).
- **Failure scenario:** a future contributor converts `deleteImage(id: number)` to `export const deleteImage = async (id: number) => {...}` without `requireSameOriginAdmin()`. `npm run lint:action-origin` emits no complaint. The defense-in-depth layer is silently removed.
- **Concrete fix:** extend the scanner to also visit `ts.isVariableStatement(statement)` with `ts.isArrowFunction` or `ts.isFunctionExpression` initializers (mirroring `check-api-auth.ts:68-80`), applying the same exemption rules. Add a regression test fixture (`scripts/__fixtures__/action-origin/arrow-export.ts`).

### C5-02 — `check-api-auth.ts` doesn't discover `.tsx` route files (Next.js 16 accepts both)
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/scripts/check-api-auth.ts:18-23`.
- **Evidence:** `findRouteFiles` filters only `route.ts` and `route.js`. Next.js 16 App Router accepts `route.tsx` identically (documented at nextjs.org/docs/app/api-reference/file-conventions/route). Today no `.tsx` route files exist under `apps/web/src/app/api/admin/`, but the scan will not catch a future one.
- **Concrete fix:** accept `route.tsx` and `route.mjs`/`route.cjs` for parity with Next.js runtime resolution.

### C5-03 — Dual tag-filter JOIN path (`getImagesLite` vs `getImages`) forces caller-side choice with no guidance in call sites
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/data.ts:318-418`.
- **Evidence:** `getImagesLite` uses a scalar subquery for `tag_names` (cheap), `getImages` uses a `GROUP BY + GROUP_CONCAT` (more expensive). Both accept the same signature. The public admin listing uses `getAdminImagesLite`; public pages use `getImagesLite`; `getImages` is the "full" variant. Documentation says "Use when tag_names need to be displayed (e.g., admin dashboard)" but the admin dashboard uses `getAdminImagesLite`, which is itself the lite variant with admin field set. `getImages` is currently unused or near-unused — the code path still exists.
- **Why it matters:** dead/near-dead code is a refactor hazard. The next reader will not know whether to extend `getImages` or delete it.
- **Fix direction:** audit callers of `getImages`; if it's only used by tests, remove it or mark `@deprecated`. If it's retained for future use, add a comment explaining when to pick it over `getImagesLite`/`getAdminImagesLite`.

### C5-04 — `getSharedGroup` invokes a view-count increment that is best-effort but never logs at the boundary
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/data.ts:660-664`.
- **Evidence:** The call to `bufferGroupViewCount(group.id)` is made AFTER the group+images query resolves, which is correct. But the function's return value is never validated at the caller, and the warning log inside `flushGroupViewCounts` is only emitted when the whole flush fails (consecutiveFailures≥1). A single-group flush failure just silently re-buffers without signal.
- **Why it matters:** during partial outage (e.g. one hot group that always times out while others succeed), the console never shows that group-N is permanently stuck being re-buffered. Capacity-dropped counts in `bufferGroupViewCount` already log, but individual-update failures are swallowed in `.catch(() => { ... re-buffer ... })`.
- **Fix direction:** when a specific `groupId` re-buffer count crosses a threshold (say 5), emit a warning. Or surface via a Prometheus-style counter if a metrics layer is later added. Low priority — only relevant when metrics/alerting exist. Mark as observational.

### C5-05 — `uploadImages` treats `imageWarning` from `processTopicImage` in `topics.ts` inconsistently relative to images.ts upload failures
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/topics.ts:101-105, 202-206`, `apps/web/src/app/actions/images.ts:296-304`.
- **Evidence:** for topic-image processing, a failure is surfaced as a non-fatal warning (`imageWarning = t('topicImageProcessingWarning')`, returns `success: true, warning`). For image-upload processing, a failure is a hard failure (filename pushed to `failedFiles`, counts against `successCount`). Both are legitimate design choices but the asymmetry is not documented.
- **Why it matters:** a reader trying to understand the upload UX contract has to reconstruct the rule from both files. A single-line comment in each clarifies the expectation. Cosmetic.

### C5-06 — `exportImagesCsv` still materializes full CSV as a single string despite the row cap
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:82-102`.
- **Evidence:** code builds `csvLines: string[]` per row then joins; at 50k rows with ~1KB avg row (tags column has `GROUP_CONCAT` up to 65535 bytes) this can balloon to 50MB–1GB in the server process. The comment ("Release the DB results array before materializing the full CSV string") only addresses one side. The returned `data: csvContent` still needs to survive React Server Actions serialization back to the admin client.
- **Why it matters:** with 50k images + heavy tag usage, the action can push 500MB+ through the RSC response channel, causing memory spikes on the serverless/PaaS edge. This matches the prior deferred item D2-03 / D6-05 — "CSV export streaming."
- **Disposition:** matches existing deferred backlog. No new work needed this cycle; cross-reference D2-03.

### C5-07 — `poolConnection.on('connection', ...)` applies only to newly created pool connections, not to pre-existing ones on restart
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/db/index.ts:46-52`.
- **Evidence:** `mysql2` fires `'connection'` only when the pool actively creates a new physical connection. If the app is in a warm state (e.g., after a long-lived `SIGUSR2` signal or tooling that persists the pool), the listener never fires for connections created before `poolConnection.on('connection', ...)` was registered. Given this is a module-top-level registration at app start, that narrow window is unlikely to matter in prod — but it's a real edge case during bootstrap.
- **Why it matters:** under extreme SSR cold-start parallelism, the first 1–2 queries might run on a connection created before the listener was bound (the listener is registered synchronously right after `createPool`, so the window is tiny but non-zero). `GROUP_CONCAT` output on those queries could silently truncate.
- **Fix direction:** defense-in-depth — issue a `pool.query('SET SESSION group_concat_max_len = 65535')` once at bootstrap (a "pre-warm" query) OR reapply on every checkout via `getConnection` wrapper. Low priority. Mark as observational.

### C5-08 — `shouldWarnMissingTrustProxy` writes state via a module-local `warnedMissingTrustProxy` flag
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/rate-limit.ts:29, 81-86`.
- **Evidence:** `warnedMissingTrustProxy` is a module-level mutable flag used to suppress duplicate `TRUST_PROXY` warnings. In a multi-process deployment, each process logs the warning at most once. In a clustered dev or serverless lambda-like setup where the module may be reloaded multiple times per process, each reload logs again. Also untestable — tests can't reset the flag (there is no `resetRateLimitWarnStateForTests`).
- **Why it matters:** minor testability gap; matches the pattern used for `resetSearchRateLimitPruneStateForTests` (exposed for tests) but nobody added a `resetTrustProxyWarnStateForTests`.
- **Fix:** add a test-only reset helper analogous to `resetSearchRateLimitPruneStateForTests`, and assert the warning appears exactly once in a dedicated test.

### C5-09 — `stripControlChars` regex misses non-BMP format controls
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/lib/sanitize.ts:6-9`.
- **Evidence:** the regex `/[\x00-\x1F\x7F-\x9F]/g` strips C0 and C1 control characters (and DEL). It does NOT strip Unicode format characters like U+200B (ZWSP), U+200E/U+200F (LTR/RTL marks), U+202A-U+202E (embedding/override), U+2060 (word joiner), or U+FEFF (ZWNBSP/BOM). Attackers sometimes use RTL/LTR overrides to visually confuse UI (e.g., filename `evil‮exe.txt` looks like `evil.txt.exe`).
- **Why it matters:** modest defense-in-depth. The upload pipeline doesn't honor user-filenames on disk (UUIDs), but `user_filename` is surfaced in admin UI + CSV export. A control-filename pasted into CSV could confuse downstream tooling.
- **Fix direction:** consider stripping the "dangerous" format controls (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF) as a separate opt-in helper `stripDangerousUnicodeFormatControls`. Keep the default `stripControlChars` unchanged to avoid breaking legitimate CJK IME input that occasionally includes ZWJ characters. Mark as observational.

### C5-10 — `getImage` prev/next subqueries fan out to 3 `OR`-branched scans; may not use `idx_images_processed_capture_date` optimally
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/data.ts:477-534`.
- **Evidence:** the prev/next lookups use OR-clauses with null-aware branching. MySQL 8 can sometimes pick `ref_or_null` but the `sql\`FALSE\`` in the NULL-capture_date path + three `AND` sub-branches typically forces a range scan on the composite index.
- **Why it matters:** for a gallery of 10k+ images, page-to-page nav time could climb from 30ms to 200ms+ per click. Already covered broadly under the PERF deferred items (D2-05 / PERF-02) — this particular path was explicitly redesigned for correct NULL handling but not for index efficiency.
- **Fix direction:** measure in prod with `EXPLAIN` first. Possibly redesign as a "seek-method" query (cursor pagination) or add a tiebreaker `id` column to the composite index so the 3rd AND branch hits the index tail cleanly. Defer — matches existing backlog D6-01 (cursor/keyset infinite scroll).

### C5-11 — `deleteImages` always uses `revalidateAllAppData()` for batches >20 but never for batches ≤20 partial failure
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/images.ts:542-552`.
- **Evidence:** the branch is purely size-based. For a batch of 19 IDs where 15 succeed, the code revalidates each individual `/p/${id}` path and each affected topic. That's fine, but it's a total of 15+affectedTopics invalidations. If the batch includes stale IDs (not found), we end up revalidating 15 image pages even though only 15 were actually deleted.
- **Why it matters:** the revalidation set is slightly wider than needed — we revalidate paths for IDs that were not actually deleted. Minor ISR cache thrash.
- **Fix:** filter `foundIds` for IDs that were actually deleted (`affectedRows`) before building the revalidation list. Low-impact, cosmetic.

## Cross-cutting observations (no new findings)

- The repo has extensive test coverage (46 vitest files). `apps/web/src/__tests__/safe-json-ld.test.ts`, `apps/web/src/__tests__/request-origin.test.ts`, and `apps/web/src/__tests__/db-pool-connection-handler.test.ts` already lock in cycle-4-rpl2 behavior.
- The lint-gates `lint:api-auth` and `lint:action-origin` close the big CSRF/authz defense-in-depth holes. C5-01 and C5-02 are the remaining gaps.
- `data.ts` remains 894 lines (matches prior-cycle ARCH-02 observation) — no regression, deferred.

## Summary

No HIGH or MEDIUM severity issues. 11 LOW findings:
- Should-fix this cycle: C5-01, C5-02 (both are gate-hardening, trivially fixable).
- Observational/defer: C5-03 through C5-11.
