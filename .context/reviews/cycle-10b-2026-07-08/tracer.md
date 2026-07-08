# Tracer Report — Cycle 10b — Evidence-Driven End-to-End Flow Tracing

**Scope:** Four complex end-to-end invariants traced against committed HEAD (`git show HEAD:<path>` semantics; the peer's dirty files — `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts` — are out of scope for all four flows and were not touched). Repo is highly converged (29+ review cycles); the goal was latent, non-obvious defects that line-by-line review misses, not re-litigating already-fixed findings.

**Method:** Four parallel sub-traces (one per flow) plus direct verification of every citation reused in this synthesis (line numbers, code excerpts, and the strongest claims were independently re-read, not taken on faith from the sub-traces).

---

## Flow 1 — Upload → GPS strip fail-closed → queue claim → Sharp fan-out → conditional UPDATE → orphan cleanup

### Observation
`uploadImages()` (`apps/web/src/app/actions/images.ts`) saves the original, conditionally strips GPS EXIF (fail-closed on structural anomaly), inserts a `processed:false` row, and enqueues background processing. `image-queue.ts` claims the job under a per-image advisory lock plus a conditional `WHERE processed = false` UPDATE. `process-image.ts` fans out to AVIF/WebP/JPEG via `Promise.allSettled`. `deleteImage`/`deleteImages` can run concurrently and do **not** take the per-image processing lock (documented as intentional).

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|---------------------------|
| 1 | Delete-during-processing races the **original file's repeated reads**, not just the post-completion UPDATE — an admin delete mid-encode causes `ENOENT` on a not-yet-opened size/format, surfacing as a spurious "processing failed" error and a wasted retry cycle, self-healing but noisy | Medium-High | Moderate (direct code path traced; timing/frequency not lab-verified) | New angle: existing hardening/tests cover the *post-completion* `affectedRows===0` race, not the *mid-encode* original-file-unlink race |
| 2 | GPS-strip fail-closed has a gap that lets GPS survive on some format | Low | Strong (against) | Every parser path returns `false`/throws on anomaly; catch-all at the function boundary also returns `false` |
| 3 | Sharp fan-out partial failure (e.g. AVIF ok, WebP throws) orphans files | Low | Strong (against) | `restorePreviousFinalPaths()` unlinks everything the failed job created; whole job re-throws and rolls back |
| 4 | Enqueue can race ahead of the GPS-strip-fail delete-and-reject (TOCTOU) | Low | Strong (against) | Enqueue is strictly sequential/awaited after the strip decision in the same async function — no interleaving possible |

### Evidence For / Against

- **For #1 (leader):** `apps/web/src/lib/process-image.ts` opens a **fresh `sharp(processingInputPath, …)` instance per size inside the per-size loop** (`generateForFormat`, loop at line ~1214, fresh instance construction at ~1258/1261) — up to 8 sizes × 3 formats, each a lazy read spread across the job's whole wall-clock duration, not one upfront read. `deleteImage`/`deleteImages` (`images.ts:613-728`) never acquire `gallerykit:image-processing:{jobId}` (confirmed absent, and CLAUDE.md documents this as deliberate) and call `cleanupPendingFileDeletion` → `deleteOriginalUploadFileStrict`, an **immediate, unconditional `fs.unlink`** of the original — not deferred until processing completes.
- **Against #1 as a *correctness* bug:** the failure is caught by the existing `Promise.allSettled` + rollback machinery (`process-image.ts` `restorePreviousFinalPaths`) and the queue's own retry/claim-check logic (`image-queue.ts` ~821-826) cleanly no-ops on retry once the row is confirmed gone. No permanent orphan, no corruption — the invariant "a deleted image leaves no dangling derivative files" still holds end-to-end.
- **Against #2/#3/#4:** confirmed clean via direct trace (per-format fresh Sharp instances close the WI-14 cross-format contamination class already; rollback path unlinks `createdFinalPaths` on any rejection; GPS-strip-then-enqueue ordering has no `await` gap).

### Rebuttal Round
- **Challenge to #1:** "This is just the already-documented/tested delete-during-processing race (AGG-C4-04), nothing new."
- **Why #1 survives as distinct:** AGG-C4-04 and its wiring test (`image-queue-delete-race-cleanup-wiring.test.ts`) cover the race at the **conditional-UPDATE boundary** (job finishes encoding, then discovers via `affectedRows===0` that the row was deleted mid-flight). Finding #1 is an **earlier** race — the delete can sever the *input* file the encoder is still mid-way through reading, which is a different failure trigger (`ENOENT` on read, not a post-hoc UPDATE check) with a different symptom (a spurious "Background processing failed" error log + one wasted retry, rather than a silent affected-rows no-op). No existing test name matches this path (checked for "ENOENT" / "mid-processing" / ties to `restorePreviousFinalPaths` timing).

### Current Best Explanation
Flow 1 is **operationally clean** (no corruption, no leak) but carries one genuine, previously-uncovered noise/waste path: admin-deleting an image while its Sharp fan-out is still reading the original produces a caught-and-logged failure plus a retry cycle rather than a silent, contained cleanup. Severity: **Low** (self-healing). Confidence the mechanism is real: **Medium-High**.

### Critical Unknown
Whether this is *purely* log noise (worst case) or whether a partially-read `sharp()` stream could, on some libvips version/error path, leave a **corrupt partial file** at a *target* path rather than cleanly rejecting (which would turn this into a real orphan/corruption bug rather than pure noise).

### Discriminating Probe
Write an integration test that starts an upload, artificially delays enough to let processing begin, deletes the image mid-fan-out (before the last format writes), and asserts (a) no file matching `{id}_*` remains under `public/uploads/{avif,webp,jpeg}/`, and (b) no unhandled promise rejection / crash — only the existing retry-then-clean-no-op log path.

---

## Flow 2 — Admin color/quality setting change → settings-hash → ETag (serve-upload vs static) → SW HEAD revalidation → client sees new bytes

### Observation
`COLOR_IMPACTING_KEYS` (`settings-hash.ts:47`, aliasing `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` in `gallery-config-shared.ts:75`) feeds a settings-hash embedded in the ETag computed by `serve-upload.ts`. CLAUDE.md documents that the **static** Next-served path (existing files under `public/uploads/`) uses only `mtime+size`, not the settings-hash, and that a setting-only change (no backfill) is invisible there until re-encode. The SW (`sw.template.js`) does a bounded HEAD-revalidation ETag diff before trusting its cache.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|---------------------------|
| 1 | The settings-hash-aware ETag on the `serveUploadFile` route handlers is **structurally unreachable** for real traffic in the default (no `IMAGE_BASE_URL`/CDN) topology, because the only URL-builder in the app (`imageUrl()`) always emits the non-locale `/uploads/{format}/{file}` path, which Next's static file server serves directly for existing files (bypassing the route handler per `next.config.ts:61-62`'s own documented precedence) — including the service worker's own `fetch(request.url, {method:'HEAD'})` probe | Medium-High | Moderate-Strong (verified both halves directly) | New: prior review history covers hash-formula correctness (which 9 keys, sort-stability), never the request-routing reachability question |
| 2 | `COLOR_IMPACTING_KEYS` is missing a byte-impacting setting | Low | Strong (against) | Cross-checked against full `GALLERY_SETTING_KEYS`; the excluded keys are all non-encoder-affecting (upload-admission-only, UI-only, etc.) |
| 3 | The settings-hash TTL/staleness (5s cache) could serve a wrong ETag right after a setting flip | Low | Strong (against) | Bounded, documented, intentional (~5s worst case); not a correctness break |

### Evidence For / Against

- **For #1:** `apps/web/src/lib/image-url.ts:53-57` `imageUrl()` is confirmed the sole path/URL builder (`normalizedPath` + optional `IMAGE_BASE_URL`/CDN prefix; no caller anywhere builds a locale-prefixed `/{locale}/uploads/...` URL). `next.config.ts:61-62` comment: *"Files live in public/uploads/, and public/ assets take precedence over the app/uploads/[...path] route handler."* `sw.template.js` (~line 387-390) does `fetch(request.url, {method:'HEAD', headers:{'If-None-Match':cachedEtag}, signal:AbortSignal.timeout(...)})` — `request.url` is exactly the `<img>`-tag URL, i.e. the non-locale static-served path. So the settings-hash-aware ETag branch of `serve-upload.ts` is reachable only for a URL nobody in the running app ever requests for an *existing* file.
- **Against treating this as harmful:** the static path's own `mtime+size` ETag still does the *correct* thing on the traffic it actually serves — unchanged (no re-encode) stays cache-fresh (correct, since bytes truly didn't change), and a real backfill re-encode changes mtime/size and correctly busts the cache. So end users are not shown *wrong* colors; they are shown **stale-until-backfill** colors exactly as CLAUDE.md's CRT-D1 gotcha already warns — the operational contract is accurate. What's broken is only the *stated purpose* of the settings-hash ETag/R10-H3 SW comment ("closes the one-stale-visit gap"), which cannot fire on the code path it was built for.
- **Where it *would* matter:** a deployment that actually sets `IMAGE_BASE_URL` to a **same-origin path-prefix reverse proxy in front of this same Next app** (not a true external CDN) could route through the route handler and get the intended benefit — but CLAUDE.md's own "Storage Backend" note says CDN switching isn't a supported/wired feature yet, so this is a narrow, likely-unused escape hatch.

### Rebuttal Round
- **Challenge:** "Maybe production actually front-ends with a reverse-proxy path that *does* hit the route handler, making this theoretical."
- **Response:** No test in `apps/web/e2e/` exercises `/uploads/...` through real Next routing to settle this either way — this is the genuine coverage gap. The documented default topology (single Next process, nginx passthrough per the shipped `nginx/default.conf`) does not proxy `/uploads/` to anything other than the same Next process, which resolves via its own static-file precedence. The finding stands for the shipped/documented topology.

### Current Best Explanation
The `settings-hash` ETag machinery in `serve-upload.ts`/`settings-hash.ts` is correct in isolation but **dead code for its stated purpose** under the shipped topology: the only URLs the app ever generates for existing derivatives are answered by Next's static server before the route handler (or the SW's HEAD probe) can ever exercise the settings-hash branch. No user-visible incorrectness results (the static path's own ETag is internally consistent), but the R10-H3 "closes the stale-visit gap" claim in the SW comment is not actually true for the default deployment. Confidence: **Medium** (both halves of the mechanism independently verified by direct read; the one thing not verified is a live Next 16.2 standalone server confirming static-precedes-route-handler at runtime — this claim is asserted, not executed, though it is consistent with documented Next.js routing precedence and repeated across many prior cycles' code comments).

### Critical Unknown
Whether there exists *any* real request shape in production (a locale-prefixed URL, a `HEAD` vs `GET` distinction, a trailing query string) that actually falls through to the route handler for an *existing* file — if one exists, the settings-hash ETag has a live purpose; if none exists, it is confirmed fully inert for existing files.

### Discriminating Probe
Run the built `standalone` server locally, `curl -I` a real existing derivative both as `/uploads/x.jpg` and `/{locale}/uploads/x.jpg`, and diff the response headers against what `serveUploadFile` would emit (presence/absence of the `settingsHash` component in the ETag) to settle definitively which handler actually answered.

---

## Flow 3 — DB restore → durable marker → admin-mutation barrier drain → advisory locks → import → post-condition migration

### Observation
`apps/web/src/app/[locale]/admin/db-actions.ts` acquires `gallerykit_db_restore` → `gallerykit_upload_processing_contract` → `gallerykit_color_pipeline_backfill` → `gallerykit_semantic_embedding_backfill` → sets the durable maintenance marker → runs a five-stage drain checklist (`shared-group-view-counts`, `image-queue`, `background-db-writes`, `maintenance-sweeps`, `admin-mutations`) → runs `mysql --one-database` import → runs `scripts/migrate.js` post-conditions.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|---------------------------|
| 1 | The drain-checklist stage **order** lets a fire-and-forget audit-log write "fall between" stages: `background-db-writes` (stage 3) drains and returns *before* `admin-mutations` (stage 5) even begins waiting, so a `logAuditEvent(...)` call registered by a mutation that is still in-flight when stage 3 runs — but whose slot doesn't release until later — is never re-drained by any subsequent stage | Medium | Moderate (mechanism directly confirmed; real-world trigger window and import-time consequence are plausible, not lab-verified) | New: no existing test (`restore-drain-checklist.test.ts`, `admin-mutation-barrier.test.ts`, `background-db-writes.test.ts`) exercises this cross-stage interaction |
| 2 | Marker-write / barrier-drain has a race letting a mutation slip through unfenced | Low | Strong (against) | Marker write + barrier flag-set are synchronous (`fs.writeFileSync`, no `await`); every mutating action holds `using mutationSlot` for its whole body; spot-checked across images/topics/collections/backfill/settings/tags/sharing/admin-users/auth/lr-tokens |
| 3 | Queue workers can commit a stale UPDATE mid-restore | Low | Strong (against) | `quiesceImageProcessingQueueForRestore` pauses+clears+`onIdle()`s the queue *after* the marker already blocks new claims; in-flight job is waited out, not raced |
| 4 | Drain-timeout or import-failure paths leave the DB exposed (marker cleared prematurely) | Low | Strong (against) | Timeout/failure paths correctly `keepMaintenance:true`; only a genuinely-nothing-imported abort clears the marker |

### Evidence For / Against

- **For #1:** `background-db-writes.ts:11-32` `trackBackgroundDbWrite()` synchronously `.add()`s the tracked promise to the `backgroundDbWrites` Set the instant it's invoked (before any `await`). `db-actions.ts` (`import` at line 24, stage array ~595-637) places `{name:'background-db-writes', drain: () => drainBackgroundDbWritesForRestore()}` at stage index 3, strictly *before* `{name:'admin-mutations', drain: () => drainAdminMutationsForRestore()}` at stage 5 (checklist is confirmed sequential/first-failure-short-circuit by its own dedicated test). `audit.ts:95` `logAuditEvent` internally `await trackBackgroundDbWrite(...)`; ~20+ call sites across `images.ts`/`topics.ts`/`tags.ts`/`sharing.ts`/`admin-users.ts` invoke it **unawaited** (`logAuditEvent(...).catch(console.debug)`), so the Set-registration happens synchronously at whatever point in the mutation's body the call is reached — which can be *after* stage 3 already observed an empty Set and returned, but *before* the mutation's `using mutationSlot` disposes (which is what stage 5 actually waits on). Stage 5 completing tells you slots are released; it does **not** re-check `backgroundDbWrites`.
- **Against overstating severity:** the import runs `mysql` **without `--force`** (confirmed at `db-actions.ts` restore invocation), so any resulting statement collision aborts the import loudly and non-zero, which correctly triggers `keepMaintenance:true` (fail-safe, not fail-silent) — the failure mode is "restore aborts, requires manual recovery," not silent corruption. This requires a fairly specific coincidence (mutation admitted just before the marker flip, audit-log write timed to land in the narrow post-stage-3 pre-import window, and a PK/table-state collision during the dump replay) to actually manifest as an import failure rather than a no-op.

### Rebuttal Round
- **Challenge to #1:** "The audit log table is dropped/recreated wholesale by `--one-database` mysqldump replay; a stray concurrent INSERT during that specific window is astronomically unlikely and, worst case, is just one lost audit row — is this really worth flagging?"
- **Why it survives, downgraded:** the mechanism is real and structural (not a timing fluke unique to one run), and the consequence isn't necessarily "lost audit row" — it can be an **explicit-value PK collision** against mysqldump's own `INSERT ... VALUES (<id>, ...)` replay if auto-increment state was already advanced by the stray write, which is a harder failure than silent loss. But the rebuttal is right that the *practical* window is narrow (requires a mutation to be caught in exactly the multi-stage-crossing moment), so this is downgraded from "high-impact" to "medium-confidence, low-frequency, correctness-adjacent operability gap" rather than a headline data-loss bug.

### Current Best Explanation
The restore drain-checklist's stage ordering has a structural gap: `background-db-writes` and `admin-mutations` are drained as two **independent, non-communicating** stages, but a fire-and-forget `logAuditEvent` write can be registered into the former's tracking Set *after* that stage already finished, using timing tied to the latter's slot-release — meaning the write is never re-drained by anything before `mysql` import begins. Impact is contained by the no-`--force` import (fails loud, not silent) but the failure would be confusing to diagnose (looks like a generic import error, not "a straggler audit write raced your restore"). Confidence: **Medium**.

### Critical Unknown
Whether `logAuditEvent`'s underlying `INSERT` really can race mysqldump's `--one-database` DROP+CREATE+bulk-INSERT replay of the exact same table in a way that produces a *visible* failure (vs. MySQL simply serializing the two connections such that the stray INSERT either commits cleanly before the DROP or blocks/errors harmlessly) — this depends on MySQL's DDL-vs-DML locking behavior during a `mysqldump --one-database` restore, which was not empirically tested here.

### Discriminating Probe
Add a two-stage ordering fix candidate to a *test* (not yet a fix): re-drain `background-db-writes` a second time immediately before `runRestore()` (after stage 5), or fold both into one combined "quiesce everything, then re-check both queues" stage — then write a regression test that registers a `trackBackgroundDbWrite` promise *during* the `admin-mutations` stage's wait and asserts the restore's pre-import state has zero outstanding background writes. This is the cheapest change that would prove/disprove the gap without needing a live MySQL race reproduction.

---

## Flow 4 — Topic slug rename (delete+insert recreate) → re-point images.topic / topicAliases.topicSlug / topic_views.topic / smart_collections.query_json

### Observation
`updateTopic()` (`apps/web/src/app/actions/topics.ts:281-404`) wraps the rename in `withTopicRouteMutationLock` + one `db.transaction`: insert new topic row → update `images.topic` → update `topicAliases.topicSlug` → update `topicViews.topic` → remap `smart_collections.query_json` (eq/in only) → delete old topic row. This is one of the most heavily-hardened flows in the repo (DBG-16-01, DBG-16-03, R17C17, R18C18).

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|---------------------------|
| 1 | An in-flight `uploadImages()` call racing a concurrent `updateTopic`/`deleteTopic` on the **same** topic can hit an FK-restrict violation on its `INSERT`, because the topic-existence check (`images.ts:265-278`) is a plain unlocked `SELECT` with a long, un-locked window (original save, HDR check, GPS-strip re-encode, restore-maintenance checks) before the actual `db.insert(images)` (line 448) — while `withTopicRouteMutationLock` is never acquired by the upload path | Medium | Moderate (mechanism directly confirmed; DB-level lock-wait behavior inferred from InnoDB semantics, not lab-verified) | New: distinct from the documented "upload quota TOCTOU" (CR-16-01/CR-17-1, about double-counting, not topic existence); not covered by any test |
| 2 | Ordering bug — re-points happen after the old row is deleted, orphaning FK children | Low | Strong (against) | Confirmed: new row inserted first, all 4 re-points happen, old row deleted last (`topic-slug-fk-registry.test.ts` locks this ordering structurally) |
| 3 | `smart_collections.query_json` remap misses nested `and`/`or` predicates | Low | Strong (against) | `remapTopicSlugInQuery` (`smart-collections.ts:522-550`) recurses into `and`/`or` children; verified correct for arbitrary nesting depth |
| 4 | `contains`/range predicates on `topic` silently break post-rename | Low | Strong (against) | `TOPIC_OPERATORS = new Set(['eq','in'])` (`smart-collections.ts:303`) — the validator structurally forbids `contains`/range on the `topic` column, so the documented caveat describes a case that cannot occur, not a live gap |
| 5 | Some other table/JSON store references topic slug outside the documented 4 | Low | Strong (against) | Grepped schema + broad codebase; no other slug-shaped reference found; `topic-slug-fk-registry.test.ts` derives the FK-child set programmatically from `schema.ts` and fails on any new undocumented FK child |

### Evidence For / Against

- **For #1:** `images.ts:265-278` does `const [topicRow] = await db.select({slug: topics.slug}).from(topics).where(eq(topics.slug, topic)).limit(1)` — no `FOR UPDATE`, no advisory lock. Between this check and `db.insert(images).values(insertValues)` at line 448, the code does: `saveOriginalAndGetMetadata` (Sharp decode), HDR-reject check, `stripGpsFromOriginal` (a full re-encode when `strip_gps_on_upload` is on — non-trivial wall-clock for large files), and two restore-maintenance re-checks. None of this holds `gallerykit_topic_route_segments`. Meanwhile `updateTopic`/`deleteTopic` hold that lock for their entire transaction, including the delete of the old topic row, which the `images.topic` FK (`onDelete: 'restrict'`) depends on for referential integrity. If the rename/delete commits in this window, the later `INSERT` (still carrying the old slug value captured at loop start) will either FK-fail (`ER_NO_REFERENCED_ROW_2`) if InnoDB doesn't block it, or block on the index gap and then FK-fail once unblocked.
- **Against this being a *correctness* defect:** the per-file `try/catch` at `images.ts:328/521` catches any exception from `db.insert(images)`, cleans up the just-saved (and possibly GPS-stripped) original via `deleteOriginalUploadFile`, and pushes the filename to `failedFiles` — a clean, graceful, self-healing failure with no orphaned DB row and no orphaned original file. This is the same "self-healing via existing generic error handling" pattern found independently in Flow 1 and Flow 3.
- **Symmetric check (delete side):** `deleteTopic`'s own check-then-delete (`topics.ts:472-500`) has the mirror-image TOCTOU (a `SELECT` for existing images inside the transaction, not a locking read), but it is safety-netted by the same `images.topic` FK-restrict constraint at the DB engine level: if a concurrent upload's `INSERT` commits before the `DELETE FROM topics` runs, the delete itself fails with `ER_ROW_IS_REFERENCED_2`, already caught and mapped to a clean user-facing error (`topics.ts:535-537`). So both directions of this race resolve safely, by design (the FK constraint doing the real work, not the app-level checks).

### Rebuttal Round
- **Challenge:** "Every documented protection in this codebase for topic mutations already assumes/relies on FK constraints as the backstop (see `createTopic`'s `ER_DUP_ENTRY` catch, `deleteTopic`'s `ER_ROW_IS_REFERENCED_2` catch) — this is the same pattern applied symmetrically, not a gap."
- **Why it's still worth flagging, downgraded:** true, the *safety* net is real and consistent with the codebase's established pattern. What's genuinely new is that this specific direction (upload racing rename) is **not documented** anywhere (CLAUDE.md's Race Condition Protections section lists "Topic slug rename," "Upload quota TOCTOU," and "`createTopic` TOCTOU" but not "upload vs. concurrent topic mutation"), and there's no test pinning the graceful-failure behavior for this specific interaction the way `topic-slug-fk-registry.test.ts` pins the rename's own internal ordering. It is a real, if narrow and already-safe, gap in documentation/test coverage rather than in behavior.

### Current Best Explanation
Flow 4's own internal re-point mechanics are **clean and unusually well-guarded** (a dedicated schema-driven registry test specifically defends against the "fix one sibling, miss the next" failure mode that caused a prior real incident, DBG-16-01). The one genuinely new angle is external to the rename transaction itself: an in-flight upload targeting a topic that gets renamed or deleted mid-upload will fail that one file gracefully (FK-restrict-enforced, caught, cleaned up) rather than corrupt anything — safe today, but undocumented and untested, so a future refactor that loosens either the upload's error handling or the FK constraint could silently reintroduce a real gap here. Confidence: **Medium** (mechanism confirmed by direct code read on both sides; DB-level lock-wait/gap-lock behavior during the race is inferred from standard InnoDB semantics, not empirically reproduced).

### Critical Unknown
Whether the practical window is ever wide enough to hit in production — i.e., how long `stripGpsFromOriginal`'s re-encode realistically takes for a large (near the 200MB cap) file, versus how long an admin realistically takes to both decide to rename/delete a topic and have that transaction's lock-holding window overlap an in-flight upload to it.

### Discriminating Probe
A targeted integration test: begin `uploadImages()` for a large-ish fixture file with `strip_gps_on_upload` on, inject an artificial delay inside a mocked `stripGpsFromOriginal`, and during that window call `updateTopic` (rename) or `deleteTopic` on the same topic from a second simulated request; assert the upload ends in `failedFiles` (not a thrown/unhandled error, not an orphaned file) and the rename/delete completes normally.

---

## Cross-Cutting Convergence Notes

All four flows converge on the **same recurring resilience pattern**, independently discovered in three of the four traces (Flow 1, Flow 3, Flow 4): a narrow, real race condition exists at a boundary the design didn't explicitly serialize, but a **generic, pre-existing safety net** (rollback-on-reject, FK-restrict-enforced-and-caught, fail-loud-without-`--force`) absorbs it into a clean failure rather than corruption. This is not fake convergence — each flow's race has a genuinely distinct trigger and mechanism (mid-encode file deletion vs. cross-stage drain-checklist gap vs. topic-mutation-vs-upload FK race) — but it is worth naming as a single meta-observation for the review synthesis: **this codebase's remaining gaps are mostly "safe but noisy/undiagnosable edge cases," not correctness bugs**, which should shape how much further effort is worth investing here (diminishing returns on this axis) versus documentation/observability improvements (a debug log line identifying *which* race triggered a given caught failure would materially help future on-call diagnosis for all three).

Flow 2 is qualitatively different: it is not a race condition at all but a **dead-code/unreachable-path** finding — mechanism that was built to solve a real problem (SW serving stale colors after a setting change) but is wired to a URL path that production traffic never actually requests, given the current URL-builder and Next's static-serving precedence.

## Summary Table (new findings only)

| Flow | Finding | Severity | Confidence | Already covered by a test? |
|------|---------|----------|------------|------------------------------|
| 1 | Delete-during-processing races the original file's repeated per-size Sharp reads (not just the post-completion UPDATE) | Low | Medium-High | No |
| 2 | Settings-hash ETag on `serve-upload.ts` is unreachable for real traffic under the default topology (shadowed by Next static serving + `imageUrl()`'s single non-locale URL shape) | Low (no wrong bytes served; contract still holds) / Medium (stated purpose false) | Medium | No |
| 3 | Restore drain-checklist stage ordering lets a fire-and-forget audit-log write escape both the `background-db-writes` and `admin-mutations` drains | Low-Medium | Medium | No |
| 4 | Concurrent topic rename/delete racing an in-flight upload to that topic is FK-safe but undocumented/untested | Low | Medium | No |

## Uncertainty Notes

- None of these findings were reproduced against a live MySQL/Next runtime; all are derived from direct, verified static code reading plus standard MySQL/InnoDB and Next.js routing semantics. Each "Discriminating Probe" above is the cheapest concrete next step to convert Medium confidence to High (or to falsify the finding) for its flow.
- Flow 4's fork sub-trace failed early due to an upstream rate limit; that flow's evidence in this report was gathered directly by the orchestrating tracer rather than via the sub-agent, using the same evidence standards (file:line citations independently re-read).
- No flow produced a High-severity or High-confidence *new* finding — this is consistent with the stated convergence state of the repo after 29+ cycles. Zero-new-findings was an explicitly valid outcome for this task; four Low/Low-Medium severity findings were found instead, each narrow and self-healing/inert rather than corrupting.
