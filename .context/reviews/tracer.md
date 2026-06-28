# Tracer Report — Cycle 22

**Date:** 2026-06-29
**Repo:** GalleryKit at `/Users/hletrd/flash-shared/gallery`
**Prior baseline:** TRACE21-05-LOW (`lint:action-origin` gates `requireSameOriginAdmin()` but not `isAdmin()`; deferred with exit criterion)

---

## Observation

Six end-to-end flows were traced with file:line citations across the GalleryKit codebase. Goal: find broken links, TOCTOU gaps, unhandled branches, and state-consistency gaps not caught in cycle 21.

Flows traced:
1. Upload → original save → PQueue claim → per-image advisory lock → Sharp parallel fan-out → conditional `processed=true` UPDATE → orphan cleanup on delete-mid-processing
2. Color detection precedence (NCLX → ICC chromaticity → ICC name allowlist) → encoder decision matrix → ETag / SW HEAD revalidation
3. Login → per-IP + per-account rate-limit buckets → bucket eviction → session issue → middleware guard → admin action `requireSameOriginAdmin` + `isAdmin`
4. View-count buffer (bufferGroupViewCount → flushGroupViewCounts → retry/eviction → shutdown flush)
5. Semantic search request → SEMANTIC_SCAN_LIMIT scan → SEMANTIC_TOP_K_MAX clamp → response
6. Migration/deploy → migrate.js journal hash post-condition → reconcileLegacySchema → drizzle migrate

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All 6 flows correct at HEAD; one new LOW structural observation (auth-guard call-order inconsistency) | High | Strong (direct file:line) | All critical paths confirm test-locked or crash-fast; ordering inconsistency is confirmed cosmetic only |
| 2 | TRACE21-05-LOW has worsened — a new action omits both auth checks | Low | Strong (negative: exhaustive grep found no such case) | Exit criterion in deferred table: no action omits both; every `requireSameOriginAdmin` caller also resolves a user |
| 3 | View-count buffer has a silent data-loss path on SIGTERM not covered by the `flushBufferedSharedGroupViewCounts` drain | Low | Strong (negative: test locks await-before-empty-check ordering) | Covered by `data-view-count-flush.test.ts` invariant |

---

## TRACE22-01: Upload → advisory lock → fan-out → orphan cleanup

**Framing:** Can a concurrent delete-mid-processing window, or a quota TOCTOU, leave orphan derivative files or corrupt the processed count?

**Evidence For (no defect):**

`apps/web/src/app/actions/images.ts`:
- Line ~228: `tracker.bytes += totalSize; tracker.count += files.length` is synchronous BEFORE the first `await`, closing the quota TOCTOU (CR-16-01). Six `settleUploadTrackerClaim` call sites exist (~244, ~249, ~273, ~277, ~542, ~564). An INVARIANT comment documents that any new `await` between claim and settle must roll the claim back.
- `getCurrentUser()` is called before quota claim; early returns before any file write do not consume quota.

`apps/web/src/lib/image-queue.ts`:
- `claimRetryScheduled = false` reset on successful claim (C4-A2 fix).
- `SELECT WHERE processed = false` check AFTER the per-image advisory lock `gallerykit:image-processing:{jobId}` is acquired — prevents delete-while-checking race.
- `verifyFile()` checks all 3 output formats are present and non-zero before the conditional UPDATE.
- `affectedRows === 0` path calls `deleteImageVariants(UPLOAD_DIR_*, filename, [])` with `[]` for a full directory scan (AGG-C4-04), covering non-default-size variants.
- Fire-and-forget caption and embedding hooks (void IIFE) fire AFTER `processed=true` is committed. No ordering constraint violated.

**Evidence Against / Gaps:**

The A3 deferred item (6 hand-placed settle sites with comment-only invariant) remains open. No automated test pins that no new `await` was inserted in the span. No images.ts upload-flow changes found in this cycle's git log.

**Verdict: CONFIRMED-CORRECT.** A3 deferred item unchanged.

---

## TRACE22-02: Color detection → encoder decision → ETag → SW revalidation

**Framing:** Could a new color detection path or ETag coverage change leave delivered bytes mismatched from their metadata or miscached?

**Evidence For (no defect):**

Full color signal precedence (NCLX `colr` → ICC chromaticity XYZ→xy → ICC name allowlist) confirmed in cycle 21 with full file:line citations. Relevant modules (`color-detection.ts`, `icc-chromaticity.ts`, `process-image.ts`, `settings-hash.ts`, `serve-upload.ts`, `sw.template.js`) have not received behavioral changes this cycle (git log shows only docs and shutdown/photo-viewer bug fixes on master since cycle 21).

`apps/web/src/lib/settings-hash.ts`: 9 `COLOR_IMPACTING_KEYS` including sorted `image_sizes`. Compile-time guard `_ColorKeysAreSettingKeys` catches typo'd/removed keys.

`apps/web/public/sw.template.js`: SW HEAD revalidation bounded by `AbortSignal.timeout(300 ms)` (AGG-R8-05). Verified unchanged.

**Evidence Against / Gaps:** Evidence carried from cycle 21 without re-reading `color-detection.ts`. Confidence high because git log shows no behavioral changes to those modules this cycle.

**Verdict: CONFIRMED-CORRECT.** Carried from cycle 21.

---

## TRACE22-03: Login rate-limit → session → middleware guard → admin actions

**Framing:**
- A: Rollback asymmetry in the two-bucket login rate limit creates a brute-force window.
- B: An admin action calls `requireSameOriginAdmin()` without `isAdmin()`, making TRACE21-05-LOW worse.
- C: The `isAdmin()` / `requireSameOriginAdmin()` call order is inconsistent across action files relative to what images.ts comments document.

**Evidence For (no defect on A and B):**

`apps/web/src/app/actions/auth.ts`:
- `loginRateLimit` (per-IP) and `accountLoginRateLimit` (per-account) both pre-incremented BEFORE Argon2 verify.
- On rate-limit exceeded: both in-memory buckets rolled back via `Promise.allSettled` (symmetric).
- On unexpected infra error (DB unavailable): NO rollback of in-memory counters (C1F-CR-04 — deliberate; over-counting safer than under-counting on infra failure).
- Session fixation prevention: insert new session + delete others in one transaction.
- `dummyHashPromise` computed at module init to equalize timing on unknown-user paths (AGG-M2/TRC-M7).

`apps/web/src/lib/auth-rate-limit.ts`:
- `rollbackLoginRateLimit`/`rollbackAccountLoginRateLimit`: decrement not delete (C1-07 rationale preserved). Lines 72-79, 87-94.
- `passwordChangeRateLimit` is a separate Map — failed password changes do not consume login budget.

Exhaustive grep for `requireSameOriginAdmin` callers without co-located `isAdmin`/`getCurrentUser`:

```
apps/web/src/app/actions/collections.ts  — isAdmin() present at lines 19, 68, 116
apps/web/src/app/actions/sharing.ts      — isAdmin() present at lines 88, 189, 310, 350
apps/web/src/app/actions/admin-backfill.ts — isAdmin() present at line 34
apps/web/src/app/actions/tags.ts         — isAdmin() present at lines 21, 46, 103, 143, 209, 269, 358
apps/web/src/app/actions/images.ts       — isAdmin()/getCurrentUser() at multiple sites
```

Every `requireSameOriginAdmin` caller also resolves the current user. TRACE21-05-LOW exit criterion is not met.

**Evidence for Hypothesis C (new observation — TRACE22-NEW-01):**

Images.ts comments at lines 930 and 1132 document: "requireSameOriginAdmin first, then isAdmin." However, in `tags.ts` (lines 46-48), `collections.ts` (lines 19-20), `sharing.ts` (lines 88-90), and `admin-backfill.ts` (lines 34-37), the order is inverted: `isAdmin()` is called first, returning early on failure, then `requireSameOriginAdmin()` is called. Both orderings reject the same request set. The difference is which error is returned first and whether a DB auth round-trip precedes an origin check. Neither ordering is a security bug. The comment in images.ts claiming it "matches existing action pattern" is false.

**Verdicts:**
- Hypothesis A: CONFIRMED-CORRECT.
- Hypothesis B: TRACE21-05-LOW UNCHANGED — no new instances.
- Hypothesis C: NEW LOW OBSERVATION — TRACE22-NEW-01 (see below).

---

## TRACE22-04: Migration flow → runMigrations post-condition → reconcileLegacySchema

**Framing:** Is a new column missing from `reconcileLegacySchema`, or does a post-condition gap allow a silent migration skip?

**Evidence For (no defect):**

`apps/web/scripts/migrate.js`:

`getAllJournalMigrations()`: reads `drizzle/meta/_journal.json`, computes SHA256 of each SQL file. Deterministic; no timing dependency.

`prepareLegacyDatabaseIfNeeded()`:
- Fresh DB: calls `reconcileLegacySchema()` then `baselineAllJournalMigrations()`. All journal hashes inserted before drizzle.migrate() runs.
- Existing DB with incomplete hash coverage: same path — reconcile idempotently, then baseline all journal entries.
- Existing DB with full hash coverage: no-op.

`reconcileLegacySchema()`: mirrors every known table and column including color/HDR columns added in migrations 0015-0018, `smart_collections` table with `query_json` column, `image_embeddings` with mediumblob and composite index, `entitlements`/`image_reactions` drops, `images.license_tier`/`images.reaction_count` drops (post-0023/0024).

`runMigrations()` post-condition (lines ~126-147): after drizzle.migrate() completes, re-reads all hashes from `__drizzle_migrations` and throws with tag list if any journal entry is missing. Surfaces non-monotonic-timestamp silently-skipped migrations at deploy time.

**Evidence Against / Gaps:**

CLAUDE.md describes `smart_collections` as storing "a JSON `rules` array" — the actual column is `query_json` everywhere in code (`db/schema.ts:297`, `scripts/migrate.js`, `lib/smart-collections.ts`). The term "rules" appears only as prose description, not as a column name. This is a CLAUDE.md terminology mismatch only; no code path is affected.

**Verdict: CONFIRMED-CORRECT.** Minor DOCS-LOW: CLAUDE.md uses "rules" where actual column name is `query_json` (no code impact).

---

## TRACE22-05: View-count buffer → flush → cap eviction → shutdown

**Framing:** Could a swap-and-drain ordering error, timer stall, or missing retry-counter cleanup on eviction silently drop view counts or corrupt retry state?

**Evidence For (no defect):**

`apps/web/src/lib/data.ts`:
- `let viewCountBuffer = new Map<number, number>()` — confirmed `let` (rebindable for C2-F01 swap).
- `bufferGroupViewCount()`: capacity guard `viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)` before increment.
- `flushGroupViewCounts()`:
  - Entry: `viewCountFlushTimer = null` BEFORE `if (isFlushing)` guard (COR-R4C11-01) — prevents stale timer handle.
  - `isFlushing` early-return re-arms a timer.
  - Drain: `const batch = viewCountBuffer; viewCountBuffer = new Map();` swap BEFORE any `db.update()`.
  - Iteration: `for (i = 0; i < entries.length; i += FLUSH_CHUNK_SIZE)` — no unbounded `Promise.all`.
  - Post-re-buffer cap enforcement: `while (viewCountBuffer.size > MAX_VIEW_COUNT_BUFFER_SIZE)` FIFO eviction, each eviction also calls `viewCountRetryCount.delete(oldestKey)` (R21C21 T3 fix — present and test-locked).
  - Backoff: `consecutiveFlushFailures` increments only on `batch.size > 0` total failure; resets only on `succeeded > 0`. Capped by `MAX_FLUSH_INTERVAL_MS` (5 min).
  - `currentFlushPromise` assigned before buffer swap; cleared in finally.
- `flushBufferedSharedGroupViewCounts()` (shutdown): `await currentFlushPromise` BEFORE `viewCountBuffer.size === 0` early return — prevents SIGTERM mid-flush from skipping the in-progress drain.

All load-bearing invariants locked by `apps/web/src/__tests__/data-view-count-flush.test.ts` (12 it() blocks including COR-R4C11-01, C2-F01 swap ordering, FIFO eviction with retry-counter cleanup, and shutdown drain ordering).

**Verdict: CONFIRMED-CORRECT.** R21C21 T3 fix (`viewCountRetryCount.delete(oldestKey)` in eviction) present and test-locked.

---

## TRACE22-06: Semantic search POST → scan cap → topK clamp → enrichment

**Framing:** Can the `SEMANTIC_SCAN_LIMIT` or `SEMANTIC_TOP_K_MAX` clamp be bypassed by type-coercion or config-read failure?

**Evidence For (no defect):**

`apps/web/src/app/api/search/semantic/route.ts` gate sequence (in order):
1. `hasTrustedSameOrigin()` — 403 on cross-origin.
2. `isRestoreMaintenanceActive()` — 503 on maintenance.
3. Content-Type: `.startsWith('application/json')` + sub-type rejection + chunked transfer rejection + Content-Length size guard + body text cap (8192 bytes, double enforcement).
4. Body shape: `typeof body.query !== 'string'` → 400.
5. `clampSemanticTopK()`: `typeof raw !== 'number'` guard — rejects booleans, arrays. `Math.min(Math.max(floor, 1), SEMANTIC_TOP_K_MAX)`.
6. Query length: `countCodePoints(query) < 3` → 400 (codepoint-aware).
7. Rate limit pre-increment BEFORE config read (COR-R5C1-04).
8. `getGalleryConfig()` fail-closed: catch sets `semanticMode = 'disabled'`.
9. Mode gate: not `'stub'` and not `'production'` → rollback + 503.
10. Embedding (after this, no rollback — AGG-12 deliberate).
11. DB scan: `.limit(SEMANTIC_SCAN_LIMIT)` hard cap in Drizzle call.
12. Similarity: `isProd ? dotProduct : cosineSimilarity` — normalized prod, raw stub.
13. `topK(scored, topKParam, activeThreshold)` — respects clamped `topKParam`.
14. Enrichment: `searchEnrichmentSelectFields` — compile-time PII guard.
15. Enrichment DB failure: falls back to `enrichedResults = []`, logs error. Rate budget already consumed; 200 with empty results returned (AGG-12 consistent — no rollback after expensive work).

`export const runtime = 'nodejs'` — R21-L1 pin.

**Evidence Against / Gaps:**

Enrichment DB failure returns 200 with empty results indistinguishable from "no matches." AGG-12 design choice, not a bug, but unobservable without server-side log inspection.

**Verdict: CONFIRMED-CORRECT.** No bypass path found.

---

## Evidence For (summary)

- TRACE22-01: `images.ts:228` synchronous quota claim; `image-queue.ts` advisory lock before SELECT; `affectedRows === 0` → full-scan `deleteImageVariants` (direct file:line).
- TRACE22-02: Color pipeline modules unchanged this cycle (git log); cycle-21 evidence carried.
- TRACE22-03: `auth.ts` two-bucket pre-increment and rollback symmetry; every `requireSameOriginAdmin` caller has co-located `isAdmin()` or user resolution (exhaustive grep).
- TRACE22-04: `migrate.js` `runMigrations` post-condition throw at lines ~138-145; `reconcileLegacySchema` covers all known tables/columns including post-0023/0024 drops.
- TRACE22-05: `data-view-count-flush.test.ts` 12-invariant fixture locks all load-bearing patterns including R21C21 T3 eviction fix.
- TRACE22-06: Gate sequence in `route.ts`; `clampSemanticTopK` typeof guard; `.limit(SEMANTIC_SCAN_LIMIT)` is direct Drizzle call.

---

## Evidence Against / Gaps

- TRACE22-01: A3 deferred item remains — 6 hand-placed settle sites with comment-only invariant, no automated enforcement.
- TRACE22-03 (Hypothesis C): `lint:action-origin` does not check call order. Images.ts comment claiming its pattern "matches existing action pattern" is contradicted by 4 other action files.
- TRACE22-04: CLAUDE.md uses "rules" terminology where actual column is `query_json`. Docs drift only.
- TRACE22-06: Enrichment DB failure returns 200 with empty results — no caller-visible distinction from "no matches." Deliberate AGG-12 but unmonitored without logs.

---

## Rebuttal Round

**Best challenge to "all flows confirmed-correct":**

The auth-guard ordering inconsistency (Hypothesis C) is not merely cosmetic if the images.ts comment claiming "matches existing action pattern" actively misleads a developer adding the next action. The developer follows the comments in the file they are copying from — if that file says `requireSameOriginAdmin` first, they write it that way; if they are in `tags.ts` territory, they write `isAdmin` first. The linter enforces neither order, so the inconsistency compounds silently over time.

**Why the leader (confirmed-correct) still stands:**

Both orderings reject the same set of requests. No security or data-integrity difference is possible since both checks must pass for the action to proceed. The only observable difference is the error message shape on a doubly-rejected request. TRACE22-NEW-01 is correctly classified LOW/Informational.

---

## Convergence / Separation Notes

- TRACE22-01 and TRACE22-05 are distinct: upload/processing is PQueue + advisory lock + file I/O; view-count buffer is process-local in-memory Map + deferred DB flush. No shared state.
- TRACE22-03 and TRACE21-05-LOW collapse to the same structural gap (linter checks only one of two required auth primitives). TRACE22-NEW-01 is a sub-finding of TRACE21-05-LOW in that it describes the same audit gap, but the specific observation (ordering inversion) is distinct.
- TRACE22-04 and TRACE22-02 share no runtime overlap; migration is deploy-time only.

---

## New Findings

### TRACE22-NEW-01 — `isAdmin()` / `requireSameOriginAdmin()` call-order contradicts images.ts documentation comment

**Severity:** LOW / Informational
**Confidence:** High (exhaustive grep)

**Location:**
- Documented pattern: `apps/web/src/app/actions/images.ts:930,1132` (comment: "requireSameOriginAdmin first, then isAdmin — matches existing action pattern")
- Actual majority pattern (reversed): `apps/web/src/app/actions/tags.ts:46-48`, `apps/web/src/app/actions/collections.ts:19-20`, `apps/web/src/app/actions/sharing.ts:88-90`, `apps/web/src/app/actions/admin-backfill.ts:34-37`

**Description:**
Images.ts comments at lines 930 and 1132 document that `requireSameOriginAdmin()` should be called before `isAdmin()`. The actual majority pattern across tags.ts, collections.ts, sharing.ts, and admin-backfill.ts calls `isAdmin()` first, returning early, then `requireSameOriginAdmin()`. Neither ordering is a security or correctness bug. The comment in images.ts claiming it "matches existing action pattern" is false and will mislead future developers.

**Recommendation:** On the next pass that touches action guard patterns — remove the false "matches existing action pattern" claim from images.ts:930 and :1132, or pick one canonical order and standardize repo-wide. Low priority; no security or data-integrity risk.

---

## Current Best Explanation

All 6 traced flows are correct at HEAD. The R21C21 T3 fix (retry-counter orphan cleanup in view-count buffer eviction) is present and test-locked. The migrate.js post-condition assertion surfaces non-monotonic journal timestamp issues as a deploy-time throw. The semantic search route correctly gates both the scan cap and result cap with no type-coercion bypass.

One new LOW/Informational finding (TRACE22-NEW-01): documentation inconsistency in images.ts about intended call order of `isAdmin()` vs `requireSameOriginAdmin()`.

No CRIT, HIGH, or MED findings discovered in cycle 22.

---

## Critical Unknown

The A3 deferred item (6 hand-placed `settleUploadTrackerClaim` sites with a comment-only invariant) remains the largest latent structural gap. There is no automated enforcement that a new `await` in the upload span also includes a settle rollback on throw.

---

## Discriminating Probe

To close A3: add a fixture-style test that reads `images.ts` source, extracts the `uploadImages` function body between the synchronous quota claim and final settle, and asserts no `await` exists in that span without a corresponding settle in the same `catch` or `finally` block. The same pattern as `data-view-count-flush.test.ts` (source-text fixture) and `backfill-color-pipeline.test.ts` (column set fixture). No DB or PQueue mocking required — source text only. This is the A3 exit criterion's concrete enforcement step (per cycle-21-deferred.md: "implement the idempotent settle-in-finally then").

---

## Uncertainty Notes

- TRACE22-02 color pipeline: evidence carried from cycle 21 without re-reading `color-detection.ts`. Confidence remains high because git log shows no behavioral changes to those modules this cycle.
- TRACE22-06 enrichment DB failure: the AGG-12 no-rollback-after-expensive-work design is intentional and correct, but the observable failure mode (200 + empty results, indistinguishable from "no matches") is a known unmonitored failure channel without server-side log inspection.
- TRACE22-NEW-01 call-order inconsistency: both orderings are functionally equivalent for security; informational only, no immediate fix required.
