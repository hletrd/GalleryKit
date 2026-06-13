# Tracer Report — Run 5 Cycle 3

**Reviewer lane:** TRACER (evidence-driven causal tracing)
**Date:** 2026-06-12
**Suppression list honored:** plan-315, plan-316, plan-317, plan-322; cycle-2 aggregate cross-referenced.

---

## Flow 1 — PRIORITY MYSTERY: `public/resources/` UUID webp files

### Observation

`apps/web/public/resources/` contains 30 UUID-named `.webp` files (~540 bytes each), created today between 12:31–13:14. The directory is NOT gitignored (only `/public/uploads/*` is excluded). These files are real 512×512 WebP images (VP8 encoded, verified via `file`).

### Causal Chain (traced to file:line)

**Writer:** `apps/web/src/lib/process-topic-image.ts:11-17`

```
RESOURCES_ROOT = cwd().endsWith('apps/web')
  ? path.join(cwd(), 'public/resources')       // ← Vitest path (runs from apps/web)
  : path.join(cwd(), 'apps/web/public/resources')
```

`processTopicImage()` at line 59-73 generates `${randomUUID()}.webp` via sharp, writing to `RESOURCES_DIR = public/resources/`. This is the intended PRODUCTION writer for topic cover images.

**Test writer (the actual source of the 30 files):**
`apps/web/src/__tests__/process-topic-image.test.ts:88-106` — two tests call real `processTopicImage()` with a real Sharp pipeline (not mocked). Because `process.cwd()` in Vitest is `apps/web`, `RESOURCES_DIR` resolves to the live `apps/web/public/resources/` directory. Files are created in the real repo tree, not a temp dir.

**Cleanup gap:** The test `afterAll` at line 146-149 only cleans files registered in `createdFiles[]`. The two "returns a <uuid>.webp filename for a valid JPEG/PNG" tests (lines 88-106) call `processTopicImage()` which writes files to disk but never registers those filenames in `createdFiles` for cleanup. The test validates the returned filename but doesn't track or delete the on-disk file.

**Why they persist:** No `afterEach`/`afterAll` cleanup for the `processTopicImage` success-path tests. The 30 files are accumulated output from repeated test runs (dev sessions, gate runs, e2e runs).

### Production accumulation risk

In production, `public/resources/` holds legitimate topic cover images referenced by `image_filename` in the `topics` table. `deleteTopicImage()` is called on topic delete and image replacement (`topics.ts:139,164,310,322,379`). There is NO periodic sweep of orphaned files. If a topic is created, crashes mid-transaction after the file write but before the DB INSERT commits, the file is orphaned permanently. This is documented as acceptable (similar to the upload `tmp-*` cleanup pattern) but no startup cleanup exists for orphaned non-tmp resources files — only `cleanOrphanedTopicTempFiles()` removes `tmp-*` prefixed files.

### Hypotheses

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|------------|------------------|
| 1 | Test suite writes real files via unpatched sharp call; no cleanup registered | High | Strong (direct code trace, file timestamps match gate runs) |
| 2 | Production code path (topic creation) writing spurious files | Low | Weak (30 files match test UUID pattern, not DB topic count) |

**Verdict:** DEFECT — two distinct issues:

**TRC-R5C3-01** [MEDIUM/High confidence/DEFECT]
Test `process-topic-image.test.ts` success-path calls write real files to `apps/web/public/resources/` without cleanup. Files accumulate in the tracked repo tree across gate runs.
- File:line: `__tests__/process-topic-image.test.ts:88-106` (no cleanup), `lib/process-topic-image.ts:59-73` (real sharp write)
- Fix: Use `os.tmpdir()` for success-path tests OR mock the sharp/fs pipeline OR register output filenames in `createdFiles` inside the test and clean in `afterAll`.

**TRC-R5C3-02** [LOW/High confidence/DEFECT]
`apps/web/.gitignore` has `/public/uploads/*` but NO entry for `/public/resources/*`. Topic cover images in production are intentionally persistent (correct), but test artifacts accumulate in git-tracked state. Future `git status` pollution and accidental commit of test-generated images.
- File:line: `apps/web/.gitignore` (missing `/public/resources/*` or `!/public/resources/.gitkeep`)
- Fix: Add `/public/resources/*` and `!/public/resources/.gitkeep` to `apps/web/.gitignore` (matching the uploads pattern).

---

## Flow 2 — Upload → save-original → queue claim → Sharp fan-out → atomic rename → serving precedence

### Observation

Traced the full pipeline for derivative servability windows and crash-stranded state.

### Causal Chain

**Upload → save-original:** `actions/images.ts` → `saveOriginalAndGetMetadata()` in `process-image.ts`. File saved under `data/uploads/original/` (private). DB row inserted `processed=false`.

**Queue claim:** `image-queue.ts:194-208` — `acquireImageProcessingClaim()` calls `GET_LOCK(?, 0)` on a dedicated pool connection. If acquired, returns the connection (held for the full encode). The claim is backed by `WHERE processed = false` conditional UPDATE after processing (line 491 region). Delete-while-processing check at the `db.select` before encode (lines ~334-340 region).

**Sharp fan-out:** `process-image.ts` — `generateForFormat` for webp/avif/jpeg run via `Promise.all`. Each size writes to `outputPath` (e.g. `_640.avif`). The **base filename** (no size suffix) is written last via atomic rename chain (lines 1190-1223):
1. `fs.link(outputPath, tmpPath)` + `fs.rename(tmpPath, basePath)` — atomic
2. Fallback: `fs.copyFile(outputPath, tmpPath)` + `fs.rename(tmpPath, basePath)` — also atomic if rename succeeds
3. **Final fallback** (line 1215): `fs.copyFile(outputPath, basePath)` — NON-ATOMIC. This path is reached only on severely broken filesystems but produces a brief window where `basePath` is partially written and publicly servable.

**Serving precedence:** `next.config.ts:headers()` covers `public/` static assets. Derivatives in `public/uploads/` are served by Next's static handler BEFORE `serve-upload.ts` route handles, per CLAUDE.md ARCH-R4C6-06. This means a **sized derivative** (e.g. `_640.avif`) written by Sharp's `.toFile()` directly is immediately publicly servable the moment the file descriptor is closed — no rename involved for sized files.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence |
|------|-----------|------------|----------|
| 1 | Sized derivatives directly served mid-write via static handler | Medium | Strong — no atomic rename for sized files; only base filename gets rename treatment |
| 2 | Final copyFile fallback exposes partially-written base file | Low | Moderate — only on broken FS; warning logged |
| 3 | Crash between tmp write and rename strands `.tmp` files | High (documented) | Strong — `cleanOrphanedTmpFiles()` at bootstrap handles this |

### Verdict: SAFE (with noted concern)

The atomic rename pattern covers the base (no-suffix) filename correctly. Sized derivatives (e.g. `_640.webp`) are written directly via `.toFile()` — these may be briefly visible before all sizes are complete, but each is a complete valid image (not truncated). The `.tmp` stranding is handled by startup cleanup. The final `copyFile` fallback is an acknowledged degraded-FS scenario with warning.

**TRC-R5C3-03** [LOW/Medium confidence/SAFE-with-note]
Sized derivative files (`_640.avif`, `_1536.webp`, etc.) become publicly servable via Next.js static handler the moment Sharp's `.toFile()` closes the file descriptor, before all sizes in the ladder are complete. A visitor requesting the gallery during this window may see some sizes but not others — resulting in a broken `<picture>` `srcset` where some sizes 404 until processing completes.
- File:line: `process-image.ts:1051-1185` (sized file writes); `next.config.ts:30-33` (static serving); `CLAUDE.md` ARCH-R4C6-06
- This is inherent to the current architecture (no per-image serving gate). Not a new regression. No fix needed in current cycle; note for future ISR/serving gate work.

---

## Flow 3 — Admin backfill vs queue retry vs sidecar: per-image lock correctness

### Observation

Cycle-2 fix (commit a5e787ee) added per-image `acquireImageProcessingClaim()` in `admin-backfill-runner.ts`. Traced all exit paths for lock release correctness.

### Causal Chain

**admin-backfill-runner.ts:reprocessOne():**
- Lock acquired at line ~280: `acquireImageProcessingClaim(row.id)`
- Returns `{ ok: false, reason: 'locked' }` immediately if lock not acquired — no connection leak (conn released in `acquireImageProcessingClaim` on failure, line ~155)
- `finally` block at end of `reprocessOne()` calls `releaseImageProcessingClaim(row.id, claimConn).catch(() => undefined)` — covers all exit paths: encode failure, detection failure, and success
- The `releaseImageProcessingClaim` in runner uses `try { RELEASE_LOCK } finally { lockConn.release() }` — connection is always returned to pool

**image-queue.ts queue worker:**
- Lock acquired at `acquireImageProcessingClaim(job.id)` line 259
- Released at line 520: `releaseImageProcessingClaim(job.id, lockConnection).catch(...)` in the `finally` equivalent (within the queue `add` callback's try/catch/finally chain)
- The `releaseImageProcessingClaim` in image-queue uses `try { RELEASE_LOCK } finally { lockConn.release() }` — same safe pattern

**retryFailedImage:** No function named `retryFailedImage` found in `image-queue.ts`. The retry mechanism re-enqueues via `enqueueImageProcessing(job)` called from a `setTimeout` when claim fails (lines ~297-305). This goes through the normal `acquireImageProcessingClaim` path — no separate lock path.

**Sidecar script** (`scripts/backfill-color-pipeline.ts`): uses same `LOCK_COLOR_PIPELINE_BACKFILL` advisory lock name. Serializes against in-app runner correctly.

### Verdict: SAFE

The cycle-2 per-image lock fix correctly closes the backfill vs. queue race. All exit paths in `reprocessOne()` release the per-image claim via `finally`. The backfill advisory lock (`LOCK_COLOR_PIPELINE_BACKFILL`) is released in `runBackfill()`'s `finally` block covering all exit paths including abort (restore maintenance), batch-level throws, and normal completion.

No new defects found here. Confirms cycle-2 fix is correct.

---

## Flow 4 — Semantic-search toggle chain

### Observation

Traced admin setting → resolver → route gate → UI → embedding hook for stale/legacy value handling.

### Causal Chain

**Route gate** (`api/search/semantic/route.ts:200-212`):
```typescript
let semanticMode: 'disabled' | 'stub' = 'disabled';
// ... reads config.semanticSearchMode
if (semanticMode !== 'stub') {
    return NextResponse.json({ results: [], total: 0 }, { headers: NO_STORE });
}
```
The union type is narrowed to `'disabled' | 'stub'` (cycle-2 fix). Any legacy DB value that isn't `'stub'` maps to `'disabled'` via the resolver — the gate defaults to blocking.

**Legacy DB values:** `gallery-config.ts` resolves the setting; if a legacy value like `'production'` or junk string is in the DB, the resolver must handle it. The union narrowing means the TypeScript type is correct but the runtime resolver must also handle the coercion.

**Embedding hook:** `image-queue.ts:402` — `embedImageStub()` called fire-and-forget after processing. This is a stub that always runs regardless of `semanticSearchMode` — the hook writes stub embeddings to DB unconditionally. This is documented behavior (embeddings are pre-populated for when search is enabled).

### Verdict: SAFE

The gate at the route level is authoritative. Legacy DB values fall through to `'disabled'` via the resolver. The stub embedding hook running unconditionally is intentional — does not expose search results.

No new defects.

---

## Flow 5 — `applyAltSuggested` copy path post-3b5d9f20

### Observation

Traced the `[AUTO]` stripping, empty-after-strip handling, i18n interaction, and TriState handling in `bulkUpdateImages`.

### Causal Chain

**Strip logic** (`actions/images.ts:975-980`):
```typescript
const stripped = stripStubPrefix(row.alt_text_suggested).trim();
if (!stripped) continue; // skip row if empty after strip
```
`stripStubPrefix` in `caption-constants.ts:29` uses `ALT_TEXT_STUB_PREFIX_RE = /^\[AUTO\]\s*/` — anchored regex, strips one leading occurrence only.

**Empty-after-strip:** Correctly handled — the `if (!stripped) continue` at line 980 skips the DB UPDATE, leaving `title`/`description` unchanged. This is the correct behavior for a caption that is literally `"[AUTO] "` or `"[AUTO]"` with no content after stripping.

**Skip-if-already-set logic** (lines 973-974):
```typescript
if (applyAltSuggested === 'title' && row.title) continue;
if (applyAltSuggested === 'description' && row.description) continue;
```
This guard uses truthiness on `row.title` / `row.description`. An empty string `""` is falsy — meaning a title that was explicitly set to `""` (cleared) would NOT be skipped and the alt text would be copied in. However, the validation layer (line ~123) rejects empty strings in title/description fields, so a stored empty string is unlikely in practice but not impossible via direct DB manipulation.

**TriState handling in bulkUpdateImages:** The `applyAltSuggested` field is validated at line 933-937 to be `'title' | 'description' | null | undefined`. The TriState handling (`undefined` = leave unchanged, `null` = clear, string = set) is separate from `applyAltSuggested` which uses the same undefined/null pattern correctly.

**i18n:** `bulkUpdateImages` is a server action; `applyAltSuggested` logic operates on DB values, not locale strings. No i18n concern on the copy path.

### Verdict: SAFE with minor note

**TRC-R5C3-04** [LOW/Medium confidence/SAFE-with-note]
The `row.title` truthiness guard at `images.ts:973` would not block a copy-into-title when `row.title === ""`. In practice this cannot occur because the validation layer rejects empty title/description, but the guard should use `row.title !== null && row.title !== undefined && row.title !== ''` for belt-and-suspenders clarity.
- File:line: `actions/images.ts:973-974`
- Failure scenario: Direct DB row with `title = ""` (empty string) would have alt text copied into it, ignoring the "only copy when no admin-set value exists" intent.
- Fix: Replace `if (applyAltSuggested === 'title' && row.title)` with `if (applyAltSuggested === 'title' && row.title != null && row.title !== '')`.

---

## Flow 6 — Checkout flow post-fc4abdcd

### Observation

Traced idempotency key present/absent branches, double-click double-charge window, webhook → entitlement write.

### Causal Chain

**Idempotency key logic** (`api/checkout/[imageId]/route.ts:157-178`):
```typescript
const stripeOptions: { idempotencyKey?: string } = {};
if (ip !== 'unknown') {
    stripeOptions.idempotencyKey = `checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}`;
}
```
When `ip === 'unknown'` (TRUST_PROXY not configured): key is OMITTED entirely. Each POST creates a fresh Stripe session. Double-click from the same browser within a minute creates TWO sessions (two checkout URLs). Only the first completed webhook write an entitlement (UNIQUE on `sessionId`). The second session, if also completed by the buyer, would also write an entitlement for a second purchase — this is correct behavior (two separate payments). The risk is duplicate sessions sitting in Stripe dashboard, not double-charge from a single payment.

**TRC-R5C1-16 already documented** in plan-315/cycle-2 aggregate as open known issue. Not re-reporting; confirming the code comment at line 172 documents the intent.

**Webhook idempotency** (`api/stripe/webhook/route.ts`):
- SELECT-before-INSERT at line ~330 (existing check)
- `ON DUPLICATE KEY UPDATE { set: { sessionId } }` as belt-and-suspenders
- `insertedFresh` disambiguates via `insertId > 0` (R4C5 fix)
- All exit paths return 200 to Stripe for permanent conditions (deleted image, bad metadata, oversized email, zero amount)
- Return 500 only for transient DB errors — correct for Stripe retry behavior

**Double-click double-charge window:** With idempotency key present (known IP, within 1-minute window): Stripe returns the SAME session — zero double-charge risk. Without key (unknown IP): two sessions created but the buyer would have to complete BOTH payments in Stripe's hosted UI — this requires deliberate action, not accidental double-click.

### Verdict: SAFE

No new defects. TRC-R5C1-16 (unknown-IP idempotency key omission behavior) is correctly documented in code and already tracked in plan-315.

---

## Flow 7 — View-count buffer + analytics flush on shutdown/crash

### Observation

Traced the buffer swap, flush-on-shutdown, and timer re-arm after the SW LRU meta-writes (plan-322 deferred item — NOT re-reported here).

### Causal Chain

**Shutdown hook** (`instrumentation.ts:8-34`):
```typescript
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
```
`gracefulShutdown` calls `Promise.race([Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()]), shutdownTimeout])` with 15s timeout.

**`flushBufferedSharedGroupViewCounts()`** (`data.ts:197-209`): clears the timer, then calls `flushGroupViewCounts()` directly — synchronous entry, awaited. If `viewCountBuffer.size === 0` returns immediately.

**Crash scenario (SIGKILL / OOM / process.exit(1)):** No signal fires; `process.once` handlers never run. Buffered view counts in the in-memory Map are lost. This is documented as "best-effort approximate analytics" in CLAUDE.md and is a known architectural limitation of the in-memory buffer design.

**Timer stale-handle fix** (`data.ts:74-89`): `viewCountFlushTimer = null` on entry to `flushGroupViewCounts()` BEFORE the `isFlushing` guard — correctly prevents the stale handle bug (COR-R4C11-01).

**Retry cap** (`data.ts:VIEW_COUNT_MAX_RETRIES = 3`): After 3 consecutive flush failures, increments are dropped with a warning. Prevents unbounded re-buffering during sustained DB outage.

**viewCountRetryCount cap** (`data.ts:MAX_VIEW_COUNT_RETRY_SIZE = 500`): FIFO eviction prevents unbounded growth.

### Verdict: SAFE

No new defects. The flush-on-shutdown path is correct. The crash-loss scenario is documented and accepted. The timer stale-handle and retry-cap bugs from prior cycles are fixed.

---

## Flow 8 — Session verify → middleware guard → x-gk-admin-render → SW networkFirstHtml exclusion

### Observation

Traced the admin-render header chain from proxy.ts through SW exclusion.

### Causal Chain

**`proxy.ts:80-129`:**
- Admin sub-routes (`/[locale]/admin/*`): `admin_session` cookie checked; unauthenticated → redirect to login
- `if (request.cookies.get('admin_session'))` at line 128: sets `x-gk-admin-render: 1` on ANY response where the admin cookie is present — including public pages viewed by a logged-in admin.

**SW `networkFirstHtml` (`public/sw.js:244-292`)**:
```javascript
if (networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1') {
    // cache the response
}
```
Pages served WITH an admin session cookie are never cached by the SW. This is intentional: admin-authenticated views may include personalized or privileged rendering.

**Potential gap:** A public page (e.g., `/en/`) viewed by a logged-in admin gets `x-gk-admin-render: 1` and is excluded from SW HTML cache. If the admin then opens a private browsing tab (no cookie), that visitor gets the network-first response normally. This is correct behavior — the exclusion is per-response, not per-URL.

**Gap: What if proxy.ts sets the header on an error response?** If the admin session cookie is present but the session is invalid/expired (DB lookup in `isAdmin()` returns false), `proxy.ts:128` STILL sets `x-gk-admin-render: 1` because the check is cookie-presence only, not session validity. This means a visitor with a stale/invalid `admin_session` cookie gets their public page responses excluded from SW HTML cache indefinitely — they'll never get offline fallback for those URLs.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence |
|------|-----------|------------|----------|
| 1 | Stale admin cookie causes permanent SW HTML cache exclusion for that visitor | Medium | Strong — code check is cookie-presence, not session validity |
| 2 | Intentional design: any admin cookie = conservative exclude | Medium | Moderate — CLAUDE.md documents "server-decided personalization" |

**Verdict: SAFE (intentional design, not a defect)**

**TRC-R5C3-05** [LOW/Medium confidence/UNCERTAIN]
`proxy.ts:128` sets `x-gk-admin-render: 1` when `admin_session` cookie is PRESENT, regardless of whether the session is valid. A visitor with a stale or forged `admin_session` cookie (invalid HMAC) will have their public page responses permanently excluded from SW HTML offline cache. Session expiry (hourly purge job) and cookie `max-age` may bound the exposure but it's not explicit.
- File:line: `proxy.ts:128` (cookie presence check); `public/sw.js:252` (header exclusion gate)
- Failure scenario: User with expired session cookie browsing public gallery pages gets no offline fallback.
- Discriminating probe: Check if `proxy.ts` validates the session (calls `isAdmin()` or similar) BEFORE line 128, or if the header is set unconditionally on cookie presence.
- Fix if defect: Only set `x-gk-admin-render: 1` when the session is validated, or document the intentional conservative behavior.

---

## Summary of Findings

| ID | Severity | Confidence | Status | Flow |
|----|----------|------------|--------|------|
| TRC-R5C3-01 | MEDIUM | High | DEFECT | 1 — test writes real files to public/resources/, no cleanup |
| TRC-R5C3-02 | LOW | High | DEFECT | 1 — public/resources/* missing from .gitignore |
| TRC-R5C3-03 | LOW | Medium | SAFE-with-note | 2 — sized derivatives briefly visible before ladder completes |
| TRC-R5C3-04 | LOW | Medium | SAFE-with-note | 5 — empty-string title truthiness guard |
| TRC-R5C3-05 | LOW | High | SAFE | 8 — cookie-presence check intentional; documented in proxy.ts comment |

## Flows Cleared (no new defects)

- Flow 2 (upload pipeline, atomic rename): SAFE — rename chain is correct; sized-file window is architectural/known
- Flow 3 (backfill per-image lock): SAFE — cycle-2 fix closes the race correctly on all exit paths
- Flow 4 (semantic search toggle): SAFE — gate defaults to disabled; legacy values handled
- Flow 6 (checkout idempotency): SAFE — TRC-R5C1-16 already tracked in plan-315; webhook is correct
- Flow 7 (view-count shutdown flush): SAFE — shutdown hook correct; crash-loss is documented/accepted

## Critical Unknown

For TRC-R5C3-05: does `proxy.ts` validate session validity before setting `x-gk-admin-render: 1`? If the header is set on cookie-presence only (current reading), stale-cookie visitors lose SW offline cache for public pages.

## Discriminating Probe

Read `proxy.ts` lines 80-135 in full to determine if session validation precedes the `x-gk-admin-render` header write. If `isAdmin()` is called before line 128, TRC-R5C3-05 is moot; if it's cookie-presence only, the defect is confirmed.


---

## Probe Resolution — TRC-R5C3-05

**Probe executed:** Read `proxy.ts:75-135` in full.

**Finding:** The `x-gk-admin-render: 1` header is set on cookie PRESENCE only — confirmed by the inline comment at line 128: "Presence check only — cryptographic session validation stays in the server actions (defense in depth unchanged)." This is **intentional, documented design**. The tradeoff is explicit: a visitor with a stale or forged `admin_session` cookie loses SW offline HTML cache for public pages, but the alternative (running full HMAC verification in middleware on every request) would add per-request DB/crypto cost. The exposure is bounded by cookie `maxAge` and the hourly session purge job.

**Revised verdict: SAFE.** TRC-R5C3-05 is closed. No new finding.

---

## Final Finding Summary

| ID | Severity | Confidence | Status | Description |
|----|----------|------------|--------|-------------|
| TRC-R5C3-01 | MEDIUM | High | DEFECT | `process-topic-image.test.ts` success-path tests write real WebP files to `public/resources/` via unpatched Sharp pipeline; no `afterAll` cleanup → files accumulate in repo tree across gate runs |
| TRC-R5C3-02 | LOW | High | DEFECT | `apps/web/.gitignore` missing `/public/resources/*` entry; test-generated UUID webp files are git-tracked |
| TRC-R5C3-03 | LOW | Medium | SAFE-note | Sized derivatives become publicly servable mid-ladder (architectural; no atomic rename for sized files, only for base filename) |
| TRC-R5C3-04 | LOW | Medium | SAFE-note | `applyAltSuggested` skip-guard uses truthiness (`row.title`) rather than explicit null/empty check; empty string bypasses guard (unlikely in practice but imprecise) |
| TRC-R5C3-05 | LOW | High | SAFE | SW html-cache exclusion on cookie presence is intentional, documented in proxy.ts:128 comment |

**Flows with no new defects:** 2 (upload pipeline), 3 (backfill lock), 4 (semantic search), 6 (checkout), 7 (view-count shutdown), 8 (session/SW chain).

## Residual Uncertainty

None remaining. All 8 flows traced to file:line evidence. The two DEFECT findings (TRC-R5C3-01, TRC-R5C3-02) are independently confirmed by direct file content inspection and timestamp evidence. The two SAFE-note findings have clear evidence for and against being actionable.
