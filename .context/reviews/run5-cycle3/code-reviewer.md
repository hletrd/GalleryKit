# Code-Reviewer Lane — Run-5 Cycle-3 Deep Review

**Reviewer angle:** code quality, logic bugs, missed edge cases, error-handling, invalid assumptions / invariant violations, data-flow / state-consistency, SOLID, maintainability.
**Repo:** GalleryKit (`apps/web`), Next.js 16 monorepo.
**Primary diff under scrutiny:** `aa5266b5..HEAD` (54 files, +2035/-345; 21 run-5 cycle-2 commits).
**Method:** read the 4 suppression plans (315/316/317/322) + cycle-2 aggregate FIRST, then full diff read, then full-repo sweep of `apps/web/src/{app/actions,lib,components,app/api,app/[locale],db}` + `scripts/`. Behavior validated from code (and one reproduction), not from comments/tests.

---

## Severity summary

| Severity | Count |
|---|---|
| CRIT | 0 |
| HIGH | 0 |
| MED  | 3 |
| LOW  | 5 |

No CRITICAL or HIGH issues at HIGH confidence → **verdict not blocked**. (See Recommendation.)

---

## Findings

### COR-R5C3-01 — Test-artifact leak: `process-topic-image.test.ts` writes real `.webp` into `public/resources/`, never cleaned up, not gitignored
- **Severity:** MED · **Confidence:** High · **Status:** confirmed (reproduced)
- **Where:**
  - Producer of leak: `apps/web/src/__tests__/process-topic-image.test.ts:91-110` — the two `processTopicImage` "returns a `<uuid>.webp` filename for a valid JPEG/PNG" tests call the REAL Sharp pipeline (`makeTinyJpegFile()` → `processTopicImage(file)`), which writes a 512×512 webp (≈540-548 B) to `RESOURCES_DIR`.
  - `apps/web/src/lib/process-topic-image.ts:11-20` — `RESOURCES_DIR` resolves to `<cwd>/public/resources` when Vitest runs from `apps/web`.
  - Gitignore gap: root `.gitignore` ignores `apps/web/public/uploads/*` (and `apps/web/.gitignore` has `/public/uploads/*`), but NOTHING ignores `public/resources/`.
- **Why it's a problem:** The `processTopicImage` `describe` block has NO `afterEach`/`afterAll`/global teardown for the UUID outputs it creates (only the unrelated `cleanOrphanedTopicTempFiles` block registers `createdFiles` for cleanup, and that covers `keep-*.webp`, not the UUID outputs). Each test run permanently leaks 2 files. There are already 30+ such files in the working tree (timestamps 12:31-13:14 today, matching repeated test/RPF runs). Because the directory is untracked AND un-ignored, `git status` shows it as `??`, and a careless `git add -A` would commit binary test garbage into the repo; on the deploy host these accumulate unbounded on the 124 G disk (CLAUDE.md "Disk hygiene").
- **Failure scenario:** A future contributor runs `npm test`, then `git add -A && git commit` — 30+ UUID webp blobs land in history. OR the CI image/deploy worktree slowly accrues thousands of orphan thumbnails over many RPF cycles.
- **Reproduction (this review):** `ls public/resources/*.webp | wc -l` → 32; `npx vitest run src/__tests__/process-topic-image.test.ts` (12 pass); re-count → 34. Exactly +2 leaked, deterministically.
- **Suggested fix:** (a) Register every `processTopicImage` return value for `afterAll` unlink (push `path.join(resourcesDir, filename)` into a cleanup list), matching the `cleanOrphanedTopicTempFiles` block's pattern; AND (b) add `public/resources/` (or `apps/web/public/resources/*` keeping a `.gitkeep`) to `.gitignore` for defense-in-depth so test/runtime thumbnails are never committable. Also delete the 30 currently-leaked files (destructive — confirm with operator first per repo rule; they are test output, safe to remove).

### COR-R5C3-02 — Admin-backfill observability counters are write-only: `getBackfillStatus()` never surfaces `encodeFailures` / `skipped*` / `lastError`, so a fully-failed run reports success to the UI
- **Severity:** MED · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:96-153` (state + `readAdminBackfillState` expose all 4 counters) vs `apps/web/src/app/actions/admin-backfill.ts:64-83` (`getBackfillStatus` — the ONLY status surface the admin UI polls — returns just `{ ok, running, candidateCount }`).
- **Why it's a problem:** Cycle-2 AGG-R5C2-10 (COR-R5C2-01/-02) added `skippedMissingOriginal`, `skippedLocked`, `encodeFailures`, `detectionFailures`, and an encode-failure `lastError` to make backfill failures visible — but the data-flow stops at `readAdminBackfillState()`. No action or component reads those fields (grep over `src/components` + `src/app` returns zero consumers outside the runner file). They appear ONLY in server `console.log`. The UI's `getBackfillStatus` returns `candidateCount`, which is the count of `pipeline_version < CURRENT` rows; encode-failed/skipped rows KEEP their stale version, so `candidateCount` does not drop. Net effect: a run where every row encode-fails returns `running:false` + the same `candidateCount` — indistinguishable from "nothing happened," and the admin gets no error signal. The cycle-2 fix is half-complete: counters computed, never delivered.
- **Failure scenario:** Operator clicks "Re-encode existing photos." Sharp/libheif throws on every original (e.g. corrupted originals or a libheif ABI mismatch). Run logs `encodeFailures=N` to stdout, `state.lastError` is set, but the admin UI shows the same candidate count and a "queued"/idle state. Admin believes the feature is broken/no-op and has no in-app diagnostic.
- **Suggested fix:** Extend `getBackfillStatus()` to return `encodeFailures`, `skippedMissingOriginal`, `skippedLocked`, `detectionFailures`, `completedRuns`, and `lastError` from `readAdminBackfillState()`, and render a per-run summary toast/row in the settings backfill UI. (Low risk — additive read; the fields already exist.)

### COR-R5C3-03 — `runBackfill` reports `Run complete` + increments `completedRuns` even when every row failed; `lastError` is set transiently and never cleared on partial success
- **Severity:** MED · **Confidence:** Med · **Status:** confirmed (logic), needs-product-decision (semantics)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:455-538`. Per-row failures (`missing-original`/`locked`/`encode-failed`/`detection-failed`) are tallied inside the PQueue task's own `try` (L460-484) and are NOT re-thrown, so they never reach the outer `catch` (L530). The loop drains, logs `Run complete: ...` (L524), and unconditionally runs `state.completedRuns++` (L529).
- **Why it's a problem (state-consistency / honesty):**
  1. `completedRuns` increments on a run that accomplished zero successful re-encodes — "completed" conflates "loop finished" with "work succeeded." Any consumer keying success off `completedRuns` (none today, but it is part of `readAdminBackfillState`'s public contract) is misled.
  2. `state.lastError` is set ONLY on the `encode-failed` branch (L477-478) and reset to `null` only at the START of the next run (L410). So after a run with 1 encode failure followed by a fully-clean run, `lastError` correctly clears; but within a single run, `lastError` reflects whichever encode-failed task happened to write last (non-deterministic under concurrency > 1) and is overwritten by later failures — it is a "some error happened" flag, not a stable diagnostic. The header comment at L1-38 promises "pick up where it left off," which is honored for stale rows, but the surfaced state does not distinguish "completed cleanly" from "completed with failures."
- **Failure scenario:** A run with 50 encode failures and 0 successes logs `Run complete: processed=0 ... encodeFailures=50` and bumps `completedRuns`. Combined with COR-R5C3-02, the admin sees a "completed" run with no error surfaced.
- **Suggested fix:** Gate the success log/`completedRuns++` on `processed > 0 || (encodeFailures+detectionFailures+skipped*+errors)===0`, or split into `completedRuns` vs `runsWithFailures`; and treat `lastError` as "last run had ≥1 encode failure (N failures)" rather than a single message. Pairs naturally with the COR-R5C3-02 UI surface fix.

### COR-R5C3-04 — Stale legacy `semantic_search_mode='production'` DB row renders a blank/empty admin Select trigger
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:531-545`. `<Select value={settings.semantic_search_mode || 'disabled'}>` with only `disabled` and `stub` `<SelectItem>`s (the `production` item was intentionally removed in cycle-2). `settings` is the RAW DB map (`initialSettings` from `getGallerySettingsAdmin()`), so a stale `'production'` row passes `'production'` as the controlled value with no matching item.
- **Why it's a problem:** Radix `<Select>` with a `value` that has no matching `<SelectItem>` renders an EMPTY `<SelectValue />` (blank trigger). The accompanying amber warning (`=== 'production'`, L549) does fire correctly and is honest, but the control itself shows nothing selected, which is confusing UX and means the admin can't see what the current (stale) value is. This is the inverse of the warning's intent.
- **Failure scenario:** An installation that set `production` before the cycle-1/2 validator tightening opens Settings → the semantic-search dropdown is blank, the amber note says "legacy production… treated as Disabled," but the trigger gives no value affordance until the admin manually re-picks.
- **Suggested fix:** Coerce the controlled value to a valid item when stale: `value={['disabled','stub'].includes(settings.semantic_search_mode) ? settings.semantic_search_mode : 'disabled'}` (the warning's `=== 'production'` check reads the raw map separately, so it still fires). Optionally render a disabled placeholder item for the legacy value.
- **Note:** Adjacent to the cycle-2 AGG-R5C2-01 honesty cluster but a DISTINCT control-rendering bug (not the docstring/disclaimer/union work that already landed). Surfaced as new.

### COR-R5C3-05 — `acquireImageProcessingClaim` / `acquireBackfillLock` swallow no error but leak a pool connection if `RELEASE_LOCK` path is bypassed by a throw between acquire and the finally
- **Severity:** LOW · **Confidence:** Med · **Status:** likely (defensive)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:195-220` (`acquireImageProcessingClaim` / `releaseImageProcessingClaim`) and the `reprocessOne` `finally` (L391-395).
- **Why it's a problem:** `reprocessOne` acquires `claimConn` at L286 and releases it in `finally` at L394 via `releaseImageProcessingClaim(...).catch(()=>undefined)`. That is sound for the normal path. However, `acquireImageProcessingClaim` itself, on the SUCCESS path, returns `lockConn` WITHOUT a try/finally — if `getImageProcessingLockName(imageId)` or the `query` resolves but the surrounding microtask is interrupted, the connection is held. More concretely: the lock is acquired on a dedicated pooled connection and only released by the explicit `RELEASE_LOCK` + `.release()`. If `processImageFormats` (L295) or `detectColorSignals` (L337) throws synchronously in a way that escapes the inner try (it does not today — both are wrapped), the `finally` still runs, so this is currently safe. The latent risk is maintainability: the lock-connection lifetime spans a large body and relies on a single `finally`; a future early `return`/`throw` added before L291's `try` (between acquire at L286 and the `try` at L291) would strand `claimConn` AND its MySQL advisory lock until pool/connection timeout.
- **Failure scenario:** A maintainer adds a guard `if (someCondition) return {ok:false,...}` between L289 and L291 → `claimConn` and the `gallerykit:image-processing:{id}` lock leak for that row until the connection is reaped, blocking the queue worker from ever claiming it.
- **Suggested fix:** Move the `acquireImageProcessingClaim` success into the `try` whose `finally` releases it (i.e. acquire, then immediately `try { ... } finally { release }`), so no code path between acquire and the protected block can strand the connection. Add a comment marking the acquire→try gap as lock-critical.

### COR-R5C3-06 — `clampSemanticTopK` now silently drops valid string topK, a behavior change from `Number(raw)` (callers must pre-coerce)
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed (intended per comment; flagged for caller-contract clarity)
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:81-86`. New guard: `if (raw !== undefined && typeof raw !== 'number') return SEMANTIC_TOP_K_DEFAULT;`
- **Why it's worth noting:** The change correctly closes the `Number(true)`/`Number([])`/`Number(['5'])` coercion holes (AGG-R5C2-33). But it ALSO now rejects a numeric STRING `"5"` (→ default) where the old `Number("5")` → 5. For a JSON body this is fine (`JSON.parse` yields a real number for `5`), and the route reads `body.topK` from parsed JSON, so no live regression. The risk is contract drift: any OTHER caller of the exported `clampSemanticTopK(raw)` that passes a stringified value (e.g. a query-param `?topK=5`, which is always a string) will now silently get the default instead of 5.
- **Failure scenario:** A future GET variant or test passes `clampSemanticTopK(searchParams.get('topK'))` (always a string) → always default 20, never the requested value, with no error.
- **Suggested fix:** Either (a) document at the export that `raw` MUST already be a JSON number (callers pre-coerce query strings), or (b) accept numeric strings explicitly: `if (typeof raw === 'string' && /^\d+$/.test(raw)) raw = Number(raw);` before the typeof guard. Cheap; prevents a silent-default footgun.

### COR-R5C3-07 — `cleanOrphanedTopicTempFiles` does NOT remove stale UUID `.webp` outputs, only `tmp-*` — orphaned thumbnails from failed/deleted topics accumulate
- **Severity:** LOW · **Confidence:** Med · **Status:** likely
- **Where:** `apps/web/src/lib/process-topic-image.ts:97-108`. The startup cleanup filters `f.startsWith('tmp-')` only.
- **Why it's a problem:** `processTopicImage` writes `<uuid>.webp` and returns the filename; `deleteTopicImage` removes it ONLY when a caller passes the exact filename (topic delete/cover-change path). If a topic row is deleted out-of-band, a DB restore drops the row, or a cover is replaced without the old filename being threaded to `deleteTopicImage`, the `<uuid>.webp` is orphaned forever. Unlike the image-derivative pipeline (which has orphan-scan cleanup), `resources/` has no reconciliation against live `topics.image_filename`. The `cleanOrphanedTopicTempFiles` name implies broader hygiene than it delivers (only crash-time `tmp-*`).
- **Failure scenario:** Over many topic edits/deletes + a DB restore, `public/resources/` accumulates unreferenced 512² thumbnails; combined with COR-R5C3-01's test leak, the directory grows unbounded with no GC.
- **Suggested fix:** Add a periodic/startup reconciliation that lists `resources/*.webp`, diffs against `SELECT image_filename FROM topics WHERE image_filename IS NOT NULL`, and unlinks unreferenced files (mirroring the image orphan-scan). Lower urgency than COR-R5C3-01 but same directory.

### COR-R5C3-08 — `getPhotoDisplayTitle` formatTitleAsTags still hashtags prose titles (only empty-token fix landed); multi-word sentence titles become `#The #quick #brown` tags
- **Severity:** LOW · **Confidence:** Med · **Status:** likely (partially addressed cycle-2)
- **Where:** `apps/web/src/lib/photo-title.ts:43-46`. Cycle-2 added `.filter(Boolean)` (COR-R5C2-03) to drop empty tokens, but the underlying design — splitting an arbitrary human title on whitespace and prefixing every word with `#` — is unchanged.
- **Why it's a problem:** The cycle-2 aggregate (AGG-R5C2-12) explicitly left open "review whether prose titles should be hashtagged at all." The empty-token fix is cosmetic; a real-world title like "Sunrise over the bay" still renders `#Sunrise #over #the #bay`, which is semantically wrong for a tag chip (stop-words become tags). This is a data-flow/representation mismatch: `formatTitleAsTags` assumes titles are tag-like tokens, but `image.title` is free prose.
- **Failure scenario:** A photo titled with a sentence shows a row of nonsense hashtags in the tag-chip surface (whichever consumer passes `formatTitleAsTags: true`).
- **Suggested fix:** Gate `formatTitleAsTags` to apply ONLY when the title is already tag-shaped (e.g. single token, or no spaces), else fall through to the plain title; or drop the pseudo-tag formatting for prose titles entirely. Confirm the actual consumer's intent before changing (find callers passing `formatTitleAsTags`).

---

## Already-planned cross-references (NOT re-reported as new)

| Observed in this pass | Already covered by | Note |
|---|---|---|
| `bulkUpdateImages` reads `topic.mode`/`titlePrefix.mode`/`description.mode`/`licenseTier.mode` (images.ts:900-927) with no TriState shape guard → malformed payload throws `TypeError` (framework 500) | **plan-315 item 1 (COR-R5C1-01)** | Confirmed STILL UNIMPLEMENTED at HEAD. Owner = plan-315. The cycle-2 `applyAltSuggested` validation landed, but the four TriState `.mode` reads remain unguarded. Do not re-plan; ensure plan-315 item 1 executes. |
| Backfill candidate scan lacks `(processed, pipeline_version, id)` index (admin-backfill-runner.ts:222-263) | **plan-322 entry 1 (AGG-R5C2-34 / PERF-R5C2-02)** | Deferred pending large-gallery evidence. |
| `getTopPhotosByViews` / breakdown queries index ordering (analytics-data.ts) | **plan-322 entry 2 & 3 (PERF-R5C2-03 / -01)** | Deferred pending EXPLAIN. The new in-file index-utilization comments are accurate. |
| Sidecar `backfill-color-pipeline.ts` does not claim per-image lock | **plan-322 entry 4b (AGG-R5C2-08 rider)** | Documented gap; header comment now present and correct. |
| OG 302 fallback / seo-og-url scheme assert | **plan-316 SEC-R5C1-04 + plan-322 entry 5** | Validator-hardening owns it. |
| SW background-revalidate / meta-write coalescing | **plan-315 item 16 + plan-322 entry 4** | SW rework not in this diff (only a comment-wording tweak landed). |
| `revalidate=0` on public pages | **plan-317 deferred #1** | Documented product trade-off. |
| `verifySessionToken` post-HMAC shape assert (session.ts:121-123) | **AGG-R5C2-30 (already landed cycle-2)** | Verified present and correctly placed AFTER the HMAC compare (no timing oracle). Not a finding — confirmed sound. |

---

## Verified-sound (examined, no finding)

- **`session.ts:121-123`** — post-HMAC `random`/`signature` regex asserts placed AFTER `timingSafeEqual`; cannot be a timing oracle. Correct.
- **`data.ts:422-428`** — `_MapSensitiveKeys = Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>` now derived from the canonical union; compile-time guard can no longer drift. Correct improvement (AGG-R5C2-32).
- **`caption-generator.ts`** — `export type { CaptionInput }` placed before the `interface CaptionInput` declaration is legal (type hoisting + `isolatedModules`-safe re-export); `import 'server-only'` guard + client-safe `caption-constants.ts` split correctly breaks the client-bundle import edge (AGG-R5C2-02). `vitest.config.ts` `server-only` alias stub is the right test accommodation.
- **`checkout/[imageId]/route.ts:181-211`** — unknown-IP now omits `idempotencyKey` entirely; `stripeOptions` object is empty `{}` in that case, Stripe treats absent key as always-new. Correct (TRC-R5C1-16).
- **`images.ts:1097`** — `state.claimRetryCounts.delete(id)` added to `retryFailedImage`; field exists on queue state (image-queue.ts:140), and the cleanup set at L97 already includes it. Correct (AGG-R5C2-37).
- **`images.ts:975-981`** — `applyAltSuggested` now strips `[AUTO]` via `stripStubPrefix` and skips rows stripping to empty. Correct (AGG-R5C2-07).
- **`error.tsx` / `not-found.tsx`** — decorative `aria-hidden` span + meaningful real/sr-only `<h1>`; `error.title`="Error" is a meaningful heading; touch-target `min-h-11` on links. Sound a11y fixes.
- **`semantic/route.ts` docstring + union narrowing + i18n** — docstring now matches the gate; `'production'` removed from the resolver union; `semanticSearchModeProduction` orphan key removed; en/ko parity for `semanticExperimentalHint`. The `=== 'production'` warning reads the RAW DB map (correct surface).
- **`use-display-capability.ts:61-110`** — comment corrections only (Firefox 110+ MQ); no behavior change; matches AGG-R5C2-04 doc fix.
- **`nav-client.tsx` LOCALE_DISPLAY_NAMES**, **home-client svg aria-hidden**, **photo-viewer aria-describedby** — correct a11y polish.

---

## Final sweep — commonly-missed areas covered

- **Off-by-one / loop bounds:** backfill keyset walk (cursor advance L510, `< BATCH_SIZE` terminator L512) — correct, terminates. PQueue drain per batch — correct.
- **Null/undefined gaps:** `bulkUpdateImages` TriState `.mode` reads — UNGUARDED (cross-ref plan-315 item 1). `clampSemanticTopK` non-number handling — addressed (COR-R5C3-06 caller-contract nuance).
- **Error-handling completeness:** backfill encode/detection failures tallied but NOT surfaced to UI (COR-R5C3-02); `Run complete` honesty (COR-R5C3-03). `processTopicImage` catch unlinks both temp + output on failure — correct.
- **Resource cleanup / leaks:** topic-thumbnail test leak (COR-R5C3-01); orphan UUID thumbnails (COR-R5C3-07); lock-connection lifetime (COR-R5C3-05).
- **State consistency:** `globalThis` symbol-keyed backfill state with defensive `??=` backfill — sound; observability counters write-only (COR-R5C3-02/03).
- **Concurrency/race:** per-image advisory lock now claimed in `reprocessOne` (AGG-R5C2-08) — correct; lock released in `finally` after UPDATE.
- **SOLID/maintainability:** `caption-constants.ts` SRP split — good; `getBackfillStatus` violates the "expose computed state" contract its own state object advertises (COR-R5C3-02).
- **Data-flow:** `formatTitleAsTags` prose-vs-tag mismatch (COR-R5C3-08); settings stale-value control rendering (COR-R5C3-04).
- **Security-adjacent (deferred to security lane):** session shape asserts verified; privacy guard derivation verified; no hardcoded secrets in diff.
- **i18n parity:** semantic keys en/ko verified equal count.
- **NOT changed in this diff (so out of scope but swept):** SW template (comment-only), Stripe webhook, OG route, db-actions, validation.ts — no new defects observed.

---

## Recommendation

**COMMENT** (no CRITICAL/HIGH at HIGH confidence; verdict not blocked).

The cycle-2 changes are generally high quality — the honesty cluster, server-only split, per-image lock, and a11y fixes all landed correctly. Three MED items warrant follow-up: the topic-thumbnail **test leak + gitignore gap (COR-R5C3-01, reproduced)**, and the **half-complete backfill observability** (COR-R5C3-02/03 — counters computed but never delivered to the UI, "completed" reported on fully-failed runs). The five LOW items are quality/robustness polish. The single highest-value action for the next planning pass is COR-R5C3-01 (concrete repo-hygiene defect with a clean reproduction) plus wiring COR-R5C3-02 so the cycle-2 observability work actually reaches an admin.
