# Tracer Report — Cycle 7

- HEAD: `a7758ef0` (run-6 cycle-7)
- Agent: tracer
- Date: 2026-06-17
- Working tree: CLEAN
- Angle: evidence-driven causal tracing of high-consequence flows with competing hypotheses (FOR / AGAINST / file+line / verdict). Independently re-read from source at HEAD.
- **Flows traced: 8** (6 re-traced from cycle-6, 2 NEW). **Actionable findings: 0.**

## TL;DR

**0 ACTIONABLE findings.** This is the expected, correct outcome for a hard-converged system (cycle finding trend 11 → 45 → 14 → 5 → 1 → 2 → **0**). No findings were fabricated.

**Delta since cycle-6 baseline `4eb83aab` is the two cycle-6 fixes landing + docs.** `git diff 4eb83aab..HEAD` over shipping code touches exactly: the 4 HDR-badge `text-white`→`text-amber-950` swaps (AGG-C6-01) and the client→server boundary test's dynamic-import/import-equals coverage (AGG-C6-02), plus a new `hdr-badge-contrast.test.ts`. **Every crown-jewel file is byte-identical to `4eb83aab`** (verified per-file: data.ts, session.ts, download-tokens.ts, download route, stripe webhook, checkout route, serve-upload.ts, settings-hash.ts, image-queue.ts, smart-collections.ts, csv-escape.ts, validation.ts — all UNCHANGED). The 6 flows that traced CLEAN at cycle-6 did so over the identical bytes, so those conclusions transfer; I independently re-read 5 of the 6 source files at HEAD to re-confirm rather than assume.

Both cycle-6 fixes are HEAD-verified: the 4 HDR badges now read `text-amber-950` (6.62:1 at the worst gradient stop, AA-pass) and the boundary test now follows `import()` + `import = require()`. Trace-corroborating tests: **83/83 pass** across hdr-badge-contrast, client-server-only-boundary, smart-collections, admin-backfill-runner-detection-failure, backfill-color-pipeline-deleted-mid-reencode, csv-escape.

---

## ACTIONABLE FINDINGS

None.

---

## NEW FLOWS TRACED THIS CYCLE

### NEW-1 — Smart-collection query building: admin JSON → AST → parameterized SQL on the PUBLIC `/c/[slug]` page. CLEAN. Read-time re-validation is the real gate.

**Observation.** Admin-defined JSON (`smart_collections.query_json`) is parsed into an AST and compiled to a SQL `WHERE` condition that runs on the PUBLIC collection page and the public load-more action. This is the classic dynamic-SQL-from-user-data surface. Can a stored query reach the DB with a non-parameterized value, an unallowlisted column, an injected operator, or a depth that diverges between validate and compile?

**Hypotheses.**
- H1 (CLEAN): every value flows through Drizzle parameter binding; columns are allowlisted at BOTH validate and compile; the read path re-validates the stored JSON so a row persisted before a guard shipped is still rejected.
- H2 (BROKEN-injection): a value path bypasses parameter binding (e.g. mysql2 object-expansion of a plain-object `value` into a `` `key`='val' `` SQL fragment), or an unallowlisted column reaches a raw `sql` template.
- H3 (BROKEN-depth-parity): `validateNode`'s depth check and `compileSmartCollection`'s depth check disagree, so a tree passes validation then blows the stack / throws at compile (or vice versa), turning a public visit into an unhandled crash.
- H4 (BROKEN-operator): the `tag` predicate is saved with an unsupported operator (`gt`/`between`/…); `compileTagPredicate` throws at read time → silent `notFound()` on every public visit.

**Evidence — parameter binding + allowlist (`apps/web/src/lib/smart-collections.ts`).**
- Direct columns resolve through the `ALLOWED_COLUMNS` map (lines 32-41); `compilePredicate` rejects anything else via `isAllowedDirectColumn` → `SmartCollectionColumnError` (lines 195-197). Operators map to Drizzle helpers `eq/gt/gte/lt/lte/inArray` (lines 202-236) and `like` with LIKE-wildcard escaping (`/[%_\\]/g` → `\$&`, lines 218-220). `between` uses `sql\`${col} BETWEEN ${p.lo} AND ${p.hi}\`` (line 225) — `col` is a Drizzle column object (not interpolated text) and `p.lo`/`p.hi` are bound parameters. **No raw string concatenation of values anywhere.** → H2 partially refuted (binding side).
- mysql2 object-expansion (the real H2 teeth): `isScalarValue` (lines 327-329) rejects anything that is not `string` or finite `number` — so a `value:{…}` / `[..]` / `null` / `NaN` is thrown out at validation BEFORE it can reach Drizzle binding (HARD-R4C4-07, lines 318-329, 369-392). → H2 fully refuted.
- `tag` predicate compiles to a parameter-bound `images.id IN (SELECT … WHERE tags.name = ${pred.value})` subquery (lines 248-272); `contains` escapes LIKE wildcards (line 260). Column refs are Drizzle objects. → H2 refuted on the tag path too.

**Evidence — read-time re-validation is the gate (defense in depth).**
- The PUBLIC page re-parses + re-compiles the stored JSON on every render: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:88` `parseSmartCollectionQuery(collection.query_json)` then `:95` `compileSmartCollection(ast)`, each wrapped in `try { … } catch { return notFound(); }` (lines 86-98).
- The public load-more action does the same: `apps/web/src/app/actions/public.ts:214-215` parse+compile inside a `try` whose `catch` returns `{status:'error'}` (lines 229-233).
- So write-time validation (`collections.ts:31`, `:80`) is NOT the sole gate — a row persisted before HARD-R4C4-07 / the tag-operator narrowing shipped is RE-validated at read time through the same `validateNode` (allowlist + scalar enforcement + depth + tag-operator narrowing) and rejected. → H1 confirmed.

**Evidence — depth parity (H3).**
- `validateNode(raw, 0)` (line 314): root at depth 0; `and`/`or` recurse children at `depth + 1` (line 344); guard `if (depth > MAX_DEPTH=4) throw` (line 332).
- `compileSmartCollection(ast, 0)` (line 156): root at depth 0; recurse children at `depth + 1` (lines 168, 176); guard `if (depth > MAX_DEPTH) throw` (line 160).
- **Identical** MAX_DEPTH (4), identical `depth+1` step, identical `> MAX_DEPTH` boundary. Anything that survives validate survives compile depth-wise; anything too deep throws in validate FIRST and is caught → `notFound()`. No divergence, no unhandled crash. → H3 refuted.

**Evidence — operator narrowing (H4).**
- `validateNode` rejects a `tag` predicate with any operator outside `{eq, contains}` (TAG_OPERATORS, lines 359-363) at validation, so the save action fails loudly instead of the public page 404ing. `compileTagPredicate` keeps its own throw (lines 269-271) as defense in depth for legacy rows — but those legacy rows ALSO hit the read-time `parseSmartCollectionQuery` re-validation first, so they fail at parse, not compile. → H4 refuted (loud-at-write, re-validated-at-read).

**Test lock.** `__tests__/smart-collections.test.ts` (part of the 83/83 pass) covers the allowlist, scalar enforcement, depth limit, LIKE escaping, and tag-operator narrowing.

**Conclusion: CLEAN.** H1 confirmed; H2/H3/H4 refuted with file:line + test evidence. The compiler is parameter-bound end-to-end, the column allowlist is enforced at both layers, depth checks are symmetric, and the PUBLIC consumers re-validate the stored JSON so stale/hostile rows can never reach the compiler with a non-scalar or unallowlisted shape. (Residual, already documented at `data.ts:1414-1420`: LIKE escaping assumes default backslash-escape SQL mode; under `NO_BACKSLASH_ESCAPES` it weakens — an accepted personal-gallery-scale risk, not a tracer-actionable defect, and the `contains` value is still parameter-bound so this is wildcard-scope abuse at worst, not injection.)

---

### NEW-2 — Image-queue per-image claim across a restart / multi-process boundary. CLEAN. Killed-process lock auto-release + conditional UPDATE prevent double-encode.

**Observation.** The per-image `gallerykit:image-processing:{id}` advisory lock is meant to stop two workers (across a process-restart boundary or a multi-process deployment) from both encoding the same upload and interleaving derivative writes. Does the claim survive a kill correctly, and can the claim-retry path duplicate-enqueue or strand a row?

**Hypotheses.**
- H1 (CLEAN): a killed process auto-releases its `GET_LOCK` on connection close; the surviving process re-discovers the still-`processed=false` row, re-claims, and its conditional UPDATE `WHERE processed=false` makes it the sole writer. The claim-retry path re-enqueues without duplication.
- H2 (BROKEN-double): two workers encode the same id concurrently and interleave writes to the same derivative filenames.
- H3 (BROKEN-strand): a row whose claim is held (or whose process died mid-claim) is dropped from `enqueued` and never re-processed, or the claim-retry path double-enqueues.

**Evidence — kill / restart boundary (`apps/web/src/lib/image-queue.ts`).**
- Claim is `SELECT GET_LOCK(?, 0)` on a dedicated pool connection (`acquireImageProcessingClaim`, lines 195-212). `GET_LOCK` is connection-scoped — a SIGKILL of process P1 drops the TCP connection and MySQL releases the lock automatically. P2 boots, `bootstrapImageProcessingQueue` re-selects `processed = false` rows (line 622) — P1 never committed `processed=true` (the conditional UPDATE at lines 370-372 runs only after full encode + 3-format verify), so the row is still pending and gets re-enqueued (lines 653-674). → H1 (kill side).
- Two LIVE processes: worker B's `GET_LOCK(?, 0)` returns 0 while A holds it → B takes the claim-retry branch (lines 262-283), never reaching `processImageFormats`. → H2 refuted. (Single-writer Compose topology anyway, but the lock makes the multi-process case safe.)
- Sole-writer commit: `UPDATE … SET processed=true … WHERE id=? AND processed=false` (lines 370-372); `affectedRows===0` ⇒ deleted-mid-processing ⇒ full-scan `deleteImageVariants(…, [])` cleanup ×3 (lines 374-391). The encoder is the effective last writer and cleans its own orphan. → H2 refuted.

**Evidence — claim-retry has no strand / no duplicate (H3).**
- Lock held ⇒ `claimRetryScheduled=true`, schedule `setTimeout(() => enqueueImageProcessing(job), delay)` (escalating 5-25 s, `.unref()`), `return` (lines 262-283).
- `finally` (lines 544-557): `releaseImageProcessingClaim(job.id, null)` is a no-op (null guard, lines 214-215). `retried` is false on this path (only the ERROR-retry sets it, line 491), so `state.enqueued.delete(job.id)` runs (line 549) — **before** the ≥5 s timer fires. When the timer re-enqueues, the `enqueued.has` guard (line 247) is already clear, so the re-enqueue proceeds exactly once. `claimRetryScheduled` guards only the `claimRetryCounts.delete` (lines 552-554), so the escalating retry count survives the re-enqueue. After `MAX_CLAIM_RETRIES=10` the row is given up AND `scheduleBootstrapRetry` re-arms a full bootstrap rescan (lines 265-272) so it is not permanently stranded. → H3 refuted.
- Restore boundary: `quiesceImageProcessingQueueForRestore` clears `enqueued`/retry maps + sets `bootstrapped=false` (lines 760-769); post-restore `resumeImageProcessingQueueAfterRestore` re-bootstraps `processed=false` rows (lines 776-786). No lost rows across a restore.

**Cross-path serialization.** The backfill runner (`admin-backfill-runner.ts:343-359`) and this queue worker claim the SAME `getImageProcessingLockName(id)` lock, so a live re-encode (via `retryFailedImage`) and a backfill of the same id serialize — the backfill SKIPS (→ `locked` tally, no version bump) rather than racing. → H2 refuted across the queue×backfill boundary.

**Conclusion: CLEAN.** H1 confirmed; H2/H3 refuted with file:line evidence. Connection-scoped `GET_LOCK` makes a killed-process claim self-healing, the conditional `WHERE processed=false` UPDATE guarantees a single committer, and the claim-retry path re-enqueues exactly once with bounded give-up + bootstrap rescan.

---

## RE-TRACED FLOWS (6 prior CLEAN flows re-confirmed at HEAD)

All 6 are over **byte-identical code** vs cycle-6 baseline `4eb83aab` (per-file `git diff` confirmed UNCHANGED). 5 of 6 source files independently re-read at HEAD this cycle.

### RE-1 — Backfill detection-failure walk-back (both paths). CLEAN; counter math exact.
- In-app runner (`admin-backfill-runner.ts`): detection throw ⇒ `signals` stays null (lines 533-554) ⇒ derivative-only UPDATE sets ONLY `was_downscaled`/`avif_10bit`, NO `pipeline_version` (lines 594-599), returns `detection-failed` (line 609). Only the success branch writes `pipeline_version = ${IMAGE_PIPELINE_VERSION}` (line 559, requires truthy `signals`). Candidate selection `pipeline_version IS NULL OR < CURRENT` (lines 374, 404) re-picks the left-behind row. Counter partition disjoint+complete (line 752); thrown UPDATE → `errors` (line 730). → CLEAN.
- Sidecar (`scripts/backfill-color-pipeline.ts`): detection-failure → `derivativeBatch` (no version bump, lines 260-263, 424-431). `flushBatch` pushes success results FIRST then derivative results (lines 422, 431), so `updateResults.slice(items.length)` (line 454) recovers EXACTLY the derivative tail; `detectionFailures -= countDeletedMidReencodeDetectionFailures(derivativeResults)` (line 455) subtracts only this-batch deleted overlap → no underflow. `computeBackfillExitCode` returns 1 on `errors||detectionFailures` (lines 174-176). → CLEAN.
- Locks: `admin-backfill-runner-detection-failure.test.ts` + `backfill-color-pipeline-deleted-mid-reencode.test.ts` (pass).

### RE-2 — Stripe paid-download (checkout → webhook → entitlement → single-use token). CLEAN; `async_payment_succeeded` gap closed operationally.
- `checkout/[imageId]/route.ts:207` `payment_method_types:['card']` (test-locked) makes `completed+unpaid` unreachable; webhook second wall `stripe/webhook/route.ts` gates `payment_status !== 'paid'`. SELECT-by-sessionId idempotency + `onDuplicateKeyUpdate` + `insertedFresh` disambiguation; deleted-image FK handled 200+manual-refund-log. Single-use claim `UPDATE entitlements SET downloadedAt=NOW(), downloadTokenHash=null WHERE id=? AND downloadedAt IS NULL` (download route) — MySQL serializes; loser gets `affectedRows===0` → 410. File `open()` before claim (no token burn on 404). All files UNCHANGED vs `4eb83aab`. → CLEAN.

### RE-3 — Settings change → ETag invalidation (both serve paths). CLEAN (asymmetric-but-correct).
- serve-upload path folds all 9 `COLOR_IMPACTING_KEYS` into `W/"v${VERSION}-${mtime}-${size}-${settingsHash}"` (settings-hash.ts + serve-upload.ts) → instant invalidation on flip. Static Next path rides the default `W/"{size}-{mtime}"` ETag, invalidated when the mandatory post-flip backfill rewrites bytes (Cache-Control deliberately NOT `immutable`). Files UNCHANGED. → CLEAN.

### RE-4 — Upload → process → delete race / double-process across workers. CLEAN.
- Re-traced fresh this cycle in NEW-2 (image-queue.ts re-read in full at HEAD). Per-image lock + `affectedRows===0` full-scan cleanup; encoder is last writer; `deleteImage` does NOT hold the per-image lock (documented basis for the cleanup backstop). All three encode paths (queue / runner / sidecar) carry the `affectedRows===0` → `deleteImageVariants(…, [])` cleanup. → CLEAN.

### RE-5 — Session verify + paid-download single-use. CLEAN; no timing oracle, no replay.
- `session.ts` `verifySessionToken`: `timingSafeEqual` over length-equalized HMAC buffers, with the `random`/`signature` shape regex DELIBERATELY placed AFTER the constant-time compare (anti-oracle, explicitly commented). DB lookup by SHA-256 hash; 24 h age cap; expired sessions deleted. `download-tokens.ts` `verifyTokenAgainstHash`: shape checks gate structure/stored-value integrity, secret compare is `timingSafeEqual`. Single-use replay closed by the atomic claim clearing `downloadTokenHash`. Files UNCHANGED. → CLEAN.

### RE-6 — View-count buffering (shared-group) swap-before-write. CLEAN; re-read at HEAD.
- `data.ts:43-200` (re-read this cycle): `viewCountFlushTimer=null` on entry (COR-R4C11-01) → `isFlushing` guard → swap `batch=viewCountBuffer; viewCountBuffer=new Map()` (lines 95-96) BEFORE any DB write (lines 105-134). Increments during flush land in the fresh map. DB write is relative `view_count = view_count + ${count}` (line 108); failures re-buffer to the fresh map with a retry cap (lines 116-130). Only loss path is process-crash-after-swap (documented best-effort tradeoff) + capacity/retry drops. No double-count, bounded loss. → CLEAN.

---

## ADDITIONAL FLOWS SPOT-CHECKED (CLEAN, not full competing-hypothesis traces)

- **CSV export escaping pipeline** (`csv-escape.ts`, re-read at HEAD): ordering is correct and load-bearing — C0/C1 strip (line 44) → Unicode-format strip via shared `UNICODE_FORMAT_CHARS_G` (line 54) → CRLF→space collapse (line 55) → formula-prefix guard `/^\s*[=+\-@]/` WITH leading-whitespace tolerance (lines 60-62) → quote-wrap (line 63). The strips run BEFORE the formula guard, so a leading ZWSP/bidi char cannot hide a `=`/`+`/`-`/`@` from the prefix guard (the documented C8R-RPL-01 bypass class). `\t` correctly absent from the char class (pre-stripped by C0/C1). Regex sourced from `validation.ts` `UNICODE_FORMAT_CHARS` (single source of truth). → CLEAN.
- **Unicode validation strip on admin string fields** (`validation.ts`, re-read at HEAD): `UNICODE_FORMAT_CHARS` (line 58) uses `\uXXXX` escapes (editor-portable, C18-LOW-01); `.test()`-only canonical const has NO `/g` flag (avoids lastIndex alternation bug), while strip consumers (`stripUnicodeFormatting`, csv-escape) derive a fresh `/g` twin from `.source` (no drift). Rejected at entry on topic alias / tag / topic.label / image.title/description / SEO fields; machine-derived EXIF strings stripped at source via `stripUnicodeFormatting`. → CLEAN.
- **Backfill concurrency cap** (`admin-backfill-runner.ts` `resolveBackfillConcurrency`, lines 129-142): NaN-guarded pool limit (line 137), `cap=max(1, floor((limit-reserved-1)/2))`, requested clamped DOWN to cap; never < 1. No NaN→frozen-PQueue path. → CLEAN.

---

## Critical Unknowns / Residual Uncertainty

None material. Every conclusion rests on tier-1/tier-2 evidence (source file:line + 83 passing locking tests). The only items not collapsible by static reading are intrinsically runtime-timing (download single-use race, view-count concurrent-flush guard, queue claim-retry interleaving) — each mediated by a DB-level atomic primitive (conditional UPDATE / relative increment / connection-scoped GET_LOCK) plus an in-process guard, and each test-locked, so the static conclusions are High confidence.

## Discriminating Probes (only if a future cycle wants runtime confirmation)

- **Smart-collection injection**: persist a `query_json` with `value:{$gt:1}` directly via SQL (bypassing the save action), then GET `/c/[slug]` — assert `notFound()` (read-time `isScalarValue` rejection), NOT a 500 or a leaked row.
- **Queue restart double-encode**: claim `gallerykit:image-processing:{id}` from an external mysql session, enqueue the job, assert the worker takes the claim-retry path (no encode); release the external lock, assert exactly one re-encode + one `processed=true` commit.
- **Download double-spend**: two concurrent `POST /api/download/{id}?token=...` → assert exactly one 200 + one 410.
