# Cycle 1 (2026-07-06) — Tracer Review

Reviewer: evidence-driven causal tracing, competing hypotheses, evidence for/against, confirmed/likely/refuted verdicts.
Repo: `/Users/hletrd/flash-shared/gallery`. HEAD: `657eb024` (== `origin/master`, clean tree at review start).
Read-only: no source files modified. Only write is this file.

Prior-context check performed before tracing: read `CLAUDE.md`, `.context/plans/cycle-96-2026-07-01-deferred.md`,
`.context/plans/cycle-98-2026-07-01-deferred.md`, and the sibling cycle-1 lanes
(`critic.md`, `security-reviewer.md`, `test-engineer.md`, `verifier.md`). None of those cover the specific
findings below (they focus on process/ledger hygiene, the nginx XFF topology question, test coverage gaps in
`collections.ts`/`embeddings.ts`, and a CLAUDE.md doc-precision note). This lane focuses on runtime causal
tracing of five assigned flows plus one additional flow, hunting for latent breaks at the seams.

## Flow 1 — Upload → tracker claim/rollback → original write → queue enqueue → claim lock → Sharp fan-out → DB conditional update → derivative serving (failure/retry/permanent-failure/deletion races)

Traced: `apps/web/src/app/actions/images.ts:128-646` (`uploadImages`), `apps/web/src/lib/upload-tracker.ts`,
`apps/web/src/lib/image-queue.ts:530-855` (`enqueueImageProcessing`), `apps/web/src/lib/process-image.ts:1049-1485`
(`processImageFormats`, atomic-write/rollback machinery), `apps/web/src/app/actions/images.ts:648-830`
(`deleteImage`/`deleteImages`), `apps/web/src/app/actions/images.ts:1207-1331` (`retryFailedImage`).

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H1.1 | Upload tracker quota claim has a TOCTOU allowing double-counting over the per-window cap | Two `await`s (disk stat, topic SELECT) follow the claim | Claim (`tracker.bytes +=`, `tracker.count +=`) happens **synchronously**, before either `await`, at `images.ts:254-256`; both awaited branches call `settleClaim(0,0)` on early return (`:278`, `:283`, `:307`, `:311`) | **Refuted** |
| H1.2 | Deleting an image mid-processing corrupts queue state or orphans derivative variants | `deleteImage`/`deleteImages` run concurrently with an in-flight `PQueue` task | Both delete actions clear `enqueued`/`permanentlyFailedIds`/`retryCounts`/`claimRetryCounts` for the id (`images.ts:697-704`, `:810-815`); the queue's conditional `UPDATE ... WHERE processed=false` (`image-queue.ts:691-693`) returns `affectedRows===0` when deleted mid-flight, triggering a **full directory scan** cleanup via `deleteImageVariants(dir, filename, [])` (`image-queue.ts:706-710`) that catches non-default-size variants too | **Refuted** |
| H1.3 | Async caption/embedding side effects (`trackQueueSideEffect`) racing a concurrent `deleteImage` corrupt data or crash the process | `image_embeddings.image_id` has `references(images.id, { onDelete: 'cascade' })` (`schema.ts:285`); the embedding side effect's `INSERT` can run **after** the image row (and thus nothing to cascade) is already gone | The `INSERT` in that case throws an ordinary FK-constraint error, which is caught at `image-queue.ts:768-772` (`try { await storeImageEmbeddingForMode(...) } catch (embedErr) { console.warn(...) }`) — no crash, no orphaned row, no corruption | **Refuted as a correctness bug** — but see **TRC-02** below (log-noise / operator-confusion finding) |
| H1.4 | Partial per-format encode failure (e.g. AVIF encode throws after WebP succeeded) leaves a publicly-servable orphan derivative for a row still marked `processed=false` | Formats are generated in parallel via `Promise.allSettled` (`process-image.ts:1436-1440`), so one format can finish writing before a sibling throws | `writeFinatePathAtomically` tracks every newly-created path in `createdFinalPaths` and every backed-up prior path in `backupFinalPaths` (`process-image.ts:1164-1225`); the outer `catch` calls `restorePreviousFinalPaths()` (`:1473-1475`), which **unlinks every path created in this invocation** and restores any backed-up previous file — this runs regardless of which of the 3 parallel formats failed | **Refuted** — rollback is complete across all formats/sizes |
| H1.5 | Bootstrap re-scan can re-enqueue a row the queue already gave up on (infinite work) | Permanent processing failures set `processing_error` in DB (`image-queue.ts:823-825`) and add to in-memory `permanentlyFailedIds` (`:796`); bootstrap excludes both (`isNull(images.processing_error)` at `:918`, `notInArray` at `:922-923`) | `retryFailedImage` (`images.ts:1207-1331`) correctly clears both the DB column and the in-memory set together before re-enqueuing, and rolls the failed state back if re-enqueue is rejected (`:1312-1327`) | **Refuted** — the *processing*-failure path is fully consistent |
| H1.6 | Claim-acquisition exhaustion (10 failed `GET_LOCK` attempts) is invisible to the admin and can loop forever | See **TRC-01** below | — | **Confirmed** |

### TRC-01 — Claim-exhaustion ("giving up" after 10 failed advisory-lock acquisitions) never surfaces to the admin and can loop indefinitely

- Severity: Medium. Confidence: High (code-confirmed for the visibility/loop mechanics); Medium for the specific real-world trigger.
- Classification: Correctness / observability gap.
- Files: `apps/web/src/lib/image-queue.ts:561-571` (give-up branch), `:506-514` (`releaseImageProcessingClaim`), `:839-842` (release call site swallows errors), `:776-838` (contrast with the *processing*-failure path, which DOES persist `processing_error`/`failed_at`/`permanentlyFailedIds`).
- Why: `enqueueImageProcessing`'s per-attempt claim logic (`image-queue.ts:560-587`) retries `acquireImageProcessingClaim` up to `MAX_CLAIM_RETRIES = 10` times with an escalating delay (`CLAIM_RETRY_DELAY_MS * min(claimRetries, 5)`, capping at 25 s/attempt — roughly 3.5 minutes total). When the 10th attempt still fails to `GET_LOCK`, the code at `:564-571` does:
  ```
  state.claimRetryCounts.delete(job.id);
  state.enqueued.delete(job.id);
  console.error(`[Queue] Job ${job.id} failed to acquire claim ${claimRetries} times, giving up`);
  state.bootstrapped = false;
  state.bootstrapCursorId = null;
  scheduleBootstrapRetry(state, ...);
  return;
  ```
  This is a bare `return` inside the `try` block — the outer `catch` (which is the ONLY place that sets `processing_error`/`failed_at` in the DB, at `:823-825`, and adds to `permanentlyFailedIds`, at `:796`) never executes. Contrast this with the sibling *processing*-failure path (Sharp throws, verify-file fails, etc.), which after `MAX_RETRIES` does persist `processing_error`+`failed_at` and make the image visible in the admin "failed images" panel with a Retry button (`retryFailedImage`, `images.ts:1207`). The claim-exhaustion path has no equivalent: the row stays `processed=false`, `processing_error IS NULL` forever, is excluded from neither `permanentlyFailedIds` nor the DB `isNull(processing_error)` bootstrap filter — so `scheduleBootstrapRetry` (30 s later) causes the **next bootstrap scan to rediscover and re-enqueue the exact same row**, which fails claim acquisition again (if whatever holds the lock still holds it), loops through another ~3.5 minutes of retries, gives up again, and reschedules again — indefinitely, with no DB-visible failure state and no admin-facing signal beyond a server-side `console.error` line.
- Failure scenario: the per-image advisory lock (`gallerykit:image-processing:{jobId}`) is server-scoped and session-bound (`acquireImageProcessingClaim`/`releaseImageProcessingClaim`, `:487-514`). CLAUDE.md itself documents the intended trigger for claim contention: "two queue workers (e.g. across a restart boundary or a multi-process deployment)". A deploy restart where the outgoing container is abruptly killed (past the 15 s graceful-shutdown window in `instrumentation.ts`) while a large Sharp encode is still in flight overlaps with the new container's bootstrap; if the overlap or the underlying connection teardown takes longer than the ~3.5-minute retry budget, the new process's job gives up silently and the image is now stuck in this unrecoverable state until, at best, the *next* bootstrap retry succeeds once the old lock is actually released. A narrower but more durable trigger: `releaseImageProcessingClaim`'s `RELEASE_LOCK` query failure is swallowed (`:840-842`, `console.debug` only) while `lockConnection.release()` still returns the physical connection to the pool (`:511-513`, in a `finally`) — if that failure occurs while the underlying MySQL session is still alive (not just a dead socket, which MySQL would auto-release locks for), the advisory lock for that `jobId` is leaked on a connection that is then reused by the pool for unrelated queries, permanently blocking any future claim for that same id.
- Fix: on claim exhaustion, persist a distinguishable failure state — either reuse the existing `processing_error`/`failed_at` columns with a specific message (e.g. "could not acquire processing lock after N attempts") so the row surfaces in the admin failed-images panel and can be retried, or add a bounded backoff/give-up ceiling so `scheduleBootstrapRetry` does not resurrect the same row forever without any operator signal. Additionally, log `RELEASE_LOCK` failures at `console.error` (not `console.debug`) since a swallowed failure here is the one path that can silently and durably wedge a per-image lock.

### TRC-02 — Deleting an image shortly after upload while embedding writes are in flight logs a raw FK-constraint error as a warning

- Severity: Low. Confidence: High.
- Classification: Observability / log-noise (not a data-integrity bug — see H1.3 above, refuted as a correctness issue).
- Files: `apps/web/src/lib/image-queue.ts:756-773` (embedding side effect, `trackQueueSideEffect`), `:768-772` (catch-and-warn), `apps/web/src/db/schema.ts:284-285` (`imageId` FK `onDelete: 'cascade'`).
- Why: the embedding write is intentionally NOT awaited by the main processing job (documented as "does not block the queue job's processed=true transition"), so an admin who deletes a just-processed image while `semantic_search_mode` is `stub`/`production` can trigger `db.insert(imageEmbeddings)...` for an `imageId` that no longer exists. The FK constraint correctly rejects the insert (no cascade target), and the code correctly catches it — but the resulting `console.warn(`[Queue] Failed to store embedding for image ${job.id}:`, embedErr)` line reads exactly like a real bug (a raw MySQL FK-violation error) in production logs for what is completely expected, harmless behavior in ordinary day-2 admin usage (upload then immediately delete).
- Failure scenario: none functional — this is purely an on-call/operator confusion risk when grepping logs after a delete-heavy admin session with semantic search enabled.
- Fix: check row existence (or catch specifically the FK-violation error code, e.g. `ER_NO_REFERENCED_ROW_2`) and log at `debug` instead of `warn` when the target image no longer exists, mirroring how the caption side effect's plain `UPDATE` already silently no-ops on a deleted row.

## Flow 2 — Admin DB restore → maintenance marker → advisory lock → import → post-conditions → marker clear → process-local flag

Traced: `apps/web/src/app/[locale]/admin/db-actions.ts:365-568` (`restoreDatabase`), `:570-761` (`runRestore`),
`apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/restore-maintenance.ts`,
`apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/instrumentation.ts:1-8` (boot-time marker sync).

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H2.1 | A crash between `beginDurableRestoreMaintenance()` and `endDurableRestoreMaintenance()` leaves the app permanently stuck with no recovery path | The durable marker (`restore-maintenance.json`) and the process-local flag are two independent pieces of state that must both clear | `syncRestoreMaintenanceFromDurable()` runs at boot (`instrumentation.ts:3-4`) to re-derive the process flag from the durable marker on every restart — fail-closed by design; a documented `restore:maintenance -- clear --confirm-clear-restore-maintenance` recovery command exists, and `beginDurableRestoreMaintenance({ allowExisting: true })` even permits *retrying* the restore itself once the underlying advisory lock is free again (`db-actions.ts:452`) | **Refuted as a bug** — working as designed |
| H2.2 | A partial/failed `mysql` restore or failed post-restore migration can silently clear the marker and resume traffic against a half-imported DB | `runRestore` resolves in several failure branches | Every failure branch that matters sets `keepMaintenance: true` (`db-actions.ts:695`, `:732`, `:746`); the outer `finally` (`:507-519`) only calls `endDurableRestoreMaintenance()`/resumes the queue when `restoreLifecycleVerified \|\| !keepRestoreMaintenance` — i.e. never on a partial/failed import unless the code explicitly opted out via `keepMaintenance:false` (only the pre-flight TLS-config-missing branch at `:664`, before any DB mutation) | **Refuted** — fail-closed is intact |
| H2.3 | The restore's own advisory locks (`LOCK_DB_RESTORE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`), all acquired on one dedicated connection, could deadlock or double-release on an early-return path | Six different early-return branches each release a different subset of already-acquired locks | Traced all six early-return branches (`:395-397`, `:405-411`, `:418-426`, `:434-446`, `:458-490`) plus the nested `finally` (`:507-541`) and outer `finally` (`:542-565`) — every branch releases exactly the locks it is documented to hold at that point, and every release is wrapped in `.catch(...)` so a release failure cannot prevent releasing the others | **Refuted** |

No new confirmed findings in this flow — already known items (SEC-02 in this cycle's security-reviewer lane: `runPostRestoreMigrations` inherits full `process.env` instead of a minimal env) are not re-reported here. This flow remains one of the most heavily hardened in the codebase; I did not find a gap the prior ~99 cycles missed.

## Flow 3 — Session issuance → cookie → `proxy.ts` guard → `isAdmin()` → expiry purge

Traced: `apps/web/src/lib/session.ts` (`generateSessionToken`, `verifySessionToken`), `apps/web/src/proxy.ts`,
`apps/web/src/app/actions/auth.ts:1-60` (`getSession`/`getCurrentUser`), `:330-453` (password-change session rotation),
`apps/web/src/lib/image-queue.ts:857-863` (`purgeExpiredSessions`, hourly GC).

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H3.1 | The hardcoded 24 h token-age check in `verifySessionToken` (`session.ts:127-134`) could invalidate sessions before their configured DB expiry, or vice versa | The check is a magic-number duplicate of the session lifetime | Cookie `maxAge` (`auth.ts:243`, `:417`) and DB `expiresAt` (`auth.ts:211`, `:392`) are both independently computed as `24 * 60 * 60 * 1000`/`* 60 * 60` — all three values agree | **Refuted** |
| H3.2 | `proxy.ts` sets `x-gk-admin-render: 1` (used by the service worker to exclude admin-personalized HTML from the offline cache) from an **unvalidated** cookie presence check on non-admin routes (`proxy.ts:117-119`), so a stale/malformed/post-logout cookie could mis-tag public responses | The format/signature validation block only runs `if (isProtectedAdminRoute(pathname))` (`:70-105`); the render-header check at `:117` has no such gate | This is fail-*safe*, not fail-open: over-tagging a response as "admin-rendered" only means it is (unnecessarily) excluded from the SW's offline HTML cache — it does not grant any admin capability or leak any other user's data (the code comment at `:113-116` explicitly notes this is presence-only and reflects only the requester's own cookie back to themselves) | **Refuted as a security issue** — confirmed intentional design, not re-reported as a finding |
| H3.3 | Password change (`auth.ts:389-419`) could strand a stolen/other-browser session or fail to protect the currently-presented cookie | — | `tx.delete(sessions).where(eq(sessions.userId, currentUser.id))` (`:404`) removes **every** session for the user (not scoped to the presented session id) inside the same transaction that updates the password hash and inserts exactly one fresh session for the current browser (`:405-409`) — this is the correct "invalidate everywhere, re-issue here" rotation | **Refuted** |

No new confirmed findings in this flow. `verifySessionToken`'s ordering (HMAC verify → shape assert → age check → DB lookup → expiry re-check-and-delete) matches the documented timing-oracle defense and I did not find a bypass.

## Flow 4 — Topic rename transaction → all slug-referencing stores

Traced: `apps/web/src/app/actions/topics.ts:182-407` (`updateTopic`), `apps/web/src/db/schema.ts` (grep for
`references(() => topics.slug`), `apps/web/src/lib/smart-collections.ts:522-550` (`remapTopicSlugInQuery`).

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H4.1 | A store added in cycles 86-99 references `topics.slug` but was never wired into the rename transaction (repeating the "fix one sibling, miss the next" pattern the codebase itself documents for `topic_views`) | Three prior misses of exactly this shape are documented in CLAUDE.md/commit history | `grep -n "references(() => topics.slug" schema.ts` returns exactly **3** hits: `topicAliases.topicSlug` (cascade), `images.topic` (restrict), `topicViews.topic` (cascade) — all three are re-pointed inside the same transaction (`topics.ts:292`, `:293`, `:301`) before the old row is deleted (`:338-339`) | **Refuted** — no new store is missed as of this HEAD |
| H4.2 | `smartCollections.query_json` predicates referencing the old slug via nested `and`/`or` groups are not fully remapped | — | `remapTopicSlugInQuery` recurses into `and`/`or` children (`smart-collections.ts:527-535`) before checking leaf predicates, so arbitrarily nested groups are covered; only `eq`/`in` operators are remapped, and `contains`/range are **deliberately** left alone per an explicit code comment, matching CLAUDE.md's documented scope | **Refuted** |

No new confirmed findings — this transaction is complete relative to the current schema.

## Flow 5 — Backfill (in-app runner + sidecar) vs live traffic vs delete-mid-reencode, including the `baefb427` pixel-cap fix

Traced: `apps/web/scripts/backfill-color-pipeline.ts:255-290`, `apps/web/src/lib/admin-backfill-runner.ts:575-610`,
both re-detection `sharp(...)` call sites and their surrounding `rowExists`/`cleanupDeletedMidReencodeVariants` handling.

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H5.1 | The `baefb427` pixel-cap fix landed in only one of the two backfill entry points, leaving the other to detect colors on an unbounded/mismatched pixel budget | The commit's own scope note says "Cycle 89 is limited to safe, narrow fixes" | Both `backfill-color-pipeline.ts:276` and `admin-backfill-runner.ts:592` pass `limitInputPixels: MAX_INPUT_PIXELS` (the same encoder-path constant, imported identically at the top of each file) to the re-detection `sharp(...)` call | **Refuted** — parity confirmed at this HEAD |
| H5.2 | The delete-mid-reencode race (row deleted while a re-encode is in flight) is only guarded in one of the two entry points | CLAUDE.md's own history calls this a "fix one sibling, miss the next" pattern for other features | Sidecar: `backfill-color-pipeline.ts:258-267` checks `rowExists` on encode error and calls `cleanupDeletedMidReencodeVariants`; in-app runner: same shape, `rowExists`/`cleanupDeletedMidReencodeVariants` pattern present around its own encode-error branch (`admin-backfill-runner.ts` ~570-577) — both also guard the UPDATE-`affectedRows===0` case per CLAUDE.md's documented contract | **Refuted** — parity confirmed |

No new confirmed findings — both backfill entry points are consistent with each other and with the encoder path as of this HEAD.

## Final sweep — PAT/Lightroom upload route (`/api/admin/lr/upload`)

Chosen because it is flagged elsewhere in this cycle only as a *test-coverage* gap (critic/test-engineer: no route-level
behavior tests), not yet traced here for implementation correctness. Traced `apps/web/src/app/api/admin/lr/upload/route.ts`
in full (595 lines).

| # | Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|---|
| H6.1 | The upload-tracker pre-claim (based on the declared `Content-Length` header) can drift from the actual bytes written, corrupting the cumulative quota | Pre-claim uses `declaredUploadBytes` (`:160-162`), actual settle uses `fileSize = fileEntry.size` (`:516`) | `settleTrackerToActual` is idempotent (`trackerSettled` guard, `:164-176`) and is called on **every** return path (success and every rejection branch), always reconciling the declared-vs-actual delta via the shared `settleUploadTrackerClaim` helper (same helper the browser path uses) | **Refuted** |
| H6.2 | A restore beginning mid-request (during multipart parsing or the save/EXIF/GPS-strip window) can race an insert into a DB the restore is about to replace | Multipart parsing and Sharp/EXIF work can take long enough to overlap a restore | The route checks `isRestoreMaintenanceActive()` twice — once at entry (`:94-99`) and again after parsing/validation but before acquiring the upload-processing-contract lock (`:257-263`) — and additionally calls `cleanupOriginalIfRestoreMaintenanceBegan` after the save+EXIF+GPS-strip window but before the DB insert (`:434-441`), deleting the orphaned original and aborting before any row is written | **Refuted** |
| H6.3 | HDR-ingest and GPS-strip admin settings are honored inconsistently vs. the browser upload path, diverging admin intent | This route is a separate implementation of the same upload contract | Both gates are present and mirror the browser path exactly (`:396-404` HDR reject, `:406-425` GPS strip with on-disk stripping, not just DB-column nulling) | **Refuted** |

No new confirmed findings — this route is at parity with the browser upload path for every guard I checked. This corroborates (from an implementation-correctness angle, not a coverage angle) the existing carry-forward finding that it lacks route-level *tests*, but I found no runtime defect.

## Summary

One confirmed new finding (TRC-01, Medium) and one confirmed new low-severity finding (TRC-02). The remaining four
assigned flows plus the final-sweep flow were traced end-to-end with explicit hypotheses and evidence, and all were
refuted — this codebase's upload/restore/session/topic-rename/backfill seams are unusually well-hardened after ~99
prior review cycles, and I did not find a regression introduced in cycles 86-99 in any of them.

## Caveats

- TRC-01's "silent infinite loop" consequence is confirmed directly from code (no DB/in-memory failure state is ever
  written on claim exhaustion). The specific real-world trigger frequency is lower-confidence: in the documented
  single-instance topology, sustained claim contention on the same `jobId` should be rare and self-resolving once the
  competing session/connection actually closes; the finding matters primarily for the *lack of a terminal, visible
  failure state* rather than a demonstrated frequent occurrence.
- I did not execute the test suite, lint, typecheck, or build as part of this lane (read-only causal tracing); the
  verifier/test-engineer lanes already ran/covered those gates this cycle.
- Line numbers cited for `image-queue.ts`, `db-actions.ts`, and `process-image.ts` were read directly from the file at
  the reviewed HEAD (`657eb024`) via the `Read` tool, not derived from search-result snippets.
