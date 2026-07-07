# Cycle 9 (loop-B) Aggregate Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: review-plan-fix 9/100 (loop-B lineage; peer run-10 loop is at cycle 18/19)
Reviewed HEAD: `6efd737b3ad5791c662fded4801701992684e54d`

## Agent Coverage

All 11 requested reviewer lanes were spawned in one parallel batch and every lane returned
and wrote its report (the document-specialist lane returned last, after a status nudge, and
self-labels its findings `DOC-C19-*`; they are ingested here as this cycle's doc lane):

- `code-reviewer.md` (CR9-01..03)
- `perf-reviewer.md` (PERF9-01 + carry-forward status table)
- `security-reviewer.md` (SEC9-01 + extensive clean-surface evidence)
- `critic.md` (CRIT9-01..03)
- `verifier.md` (VER9-01..05; 4 of 4 spot-checked cycle-18 closures CONFIRMED genuinely closed)
- `test-engineer.md` (TEST9-01..05)
- `tracer.md` (TRC9-01 defect, TRC9-02 confirmed-correct)
- `architect.md` (ARCH9-01..03)
- `debugger.md` (DBG9-01)
- `document-specialist.md` (DOC-C19-01..05)
- `designer.md` (DES9-01; live-browser verified against a dev server)

Agent failures: none (one delayed lane, no retry needed).

Peer-loop dedup note: the peer run-10 loop's cycle-18 register (`.context/reviews/_aggregate.md`
at HEAD, plus `cycle-18-2026-07-08-{plan,deferred}.md`) was distributed to every lane as a
do-not-re-report list. The peer's cycle-19 lanes are CONCURRENTLY rewriting the top-level
`.context/reviews/*.md` files (peer-dirty; not touched by this cycle). Findings below were
individually source-verified against HEAD `6efd737b` by the orchestrating lane before aggregation.

## Summary

- Unique deduped findings: 28
- Confirmed source defects: 13 (AGG9B-01..05, AGG9B-19, AGG9B-21..24, AGG9B-26..28)
- Test/enforcement gaps: 6 (AGG9B-07..12)
- Design-debt / decision items: 2 (AGG9B-13, AGG9B-14)
- A11y: 1 (AGG9B-15)
- Authorization-model gap: 1 (AGG9B-06)
- Ledger/provenance: 4 (AGG9B-16..18, AGG9B-20)
- Manual-validation risk: 1 (AGG9B-25)
- Strongest cross-agent agreement: CLIP backfill premature-termination (3 lanes:
  debugger + critic + document-specialist) and PAT `last_used_at` marked before content
  validation/mid-request restore re-checks (2 lanes: code-reviewer + critic).

Reconstruction note: the code-reviewer lane's file ends with "see below for their
integrated findings" but the sub-sweep section itself never landed in the file (agent
truncation). The orchestrator relayed the sub-sweep results; each was independently
re-verified against HEAD source by the aggregating lane before inclusion below as
AGG9B-21..28 (source findings labeled `CR9-S*`).

## Findings

### AGG9B-01 - PAT `last_used_at` is still marked before request-content validation and before the mid-request restore-maintenance re-checks

- Severity: High
- Confidence: High
- Source findings: `CR9-01`, `CRIT9-01` (cross-agent: code-reviewer + critic)
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:160` (mark site), `:182`
  (`request.formData()` — body not yet parsed at mark time), `:254-265` (second
  `isRestoreMaintenanceActive()` re-check, the C61-02 race this fix was meant to close),
  `:438-452` (third re-check), `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:286,313`
- Problem: the cycle-18 fix moved `markAdminAuthTokenUsed` after the ENTRY gates only. Every
  rejection after multipart parsing — invalid body, missing file, oversized file, unknown/renamed
  topic slug (404, the most common real Lightroom publish misconfiguration), title too long,
  restore beginning mid-parse (the exact C61-02 race), contract-lock unavailable, disk full,
  RAW/HDR rejection, GPS-strip failure, or any thrown EXIF/insert error — still bumps
  `last_used_at` first. The regression test uses a static `mockReturnValue(true)` so the
  mid-request race window is structurally untested.
- Failure scenario: a publish profile points at a renamed topic; every attempt 404s while the
  Tokens page shows "last used: 2 minutes ago", masking 100% failure. Incident responders treat
  `last_used_at` as evidence of successful upload in exactly the restore-race window the fix
  was written for.
- Suggested fix: move the mark to immediately before the success return (or at minimum after
  `formData()` parsing + all 4xx validation + the second restore re-check), keep the idempotent
  WeakSet guard, and add a sequenced-mock regression (`false` then `true`) proving the C61-02
  window no longer marks.

### AGG9B-02 - CLIP embedding backfill terminates early on skip-heavy corpora when the attempt budget clamps the SQL LIMIT

- Severity: Medium (operator-facing correctness of the documented completion contract)
- Confidence: High
- Source findings: `DBG9-01`, `CRIT9-02`, `DOC-C19-01` (cross-agent: debugger + critic + document-specialist)
- Citations: `apps/web/src/app/actions/embeddings.ts:168` (`.limit(Math.min(BACKFILL_BATCH_SIZE, remainingEmbeddingBudget))`),
  `:211` (`if (pending.length < BACKFILL_BATCH_SIZE) break;`),
  `apps/web/scripts/backfill-clip-embeddings.ts:189,244` (identical pattern, `BATCH_SIZE` 50)
- Problem: `remainingEmbeddingBudget` counts embedding ATTEMPTS but is fed into the SQL row
  LIMIT. Once the budget drops below the batch size, a full budget-clamped page satisfies
  `rows.length < BATCH_SIZE` and the loop breaks as if the table were exhausted — without the
  `Reached SEMANTIC_SCAN_LIMIT` log, which the runbook says is the operator's only re-run
  signal. Skip rows (missing originals) don't consume budget, so a skip-heavy window at the
  boundary ends the run with real embeddable rows never fetched; a re-run retraces and stalls
  at the same point.
- Failure scenario: gallery with >2000 un-embedded rows plus a band of missing-original rows;
  the production `--force` backfill exits "complete", the operator enables production search,
  and older valid photos are silently unsearchable.
- Suggested fix: always fetch a full batch page (`.limit(BATCH_SIZE)`) and enforce the attempt
  budget at the per-row attempt point (or break only on `rows.length < fetchLimit`); apply to
  BOTH the action and the sidecar; add a regression with skip rows at the budget boundary
  followed by valid rows.

### AGG9B-03 - SW image LRU: stale-read eviction decision can discard a concurrently-refreshed entry (TOCTOU)

- Severity: Medium (perf/reliability; no data or security impact)
- Confidence: Medium-High
- Source findings: `TRC9-01`
- Citations: `apps/web/public/sw.template.js:277-289` (`evictExpiredCachedImage`: queued read,
  decision OUTSIDE the queue, separate queued `deleteMeta`), `:181-216` (`touchMeta`),
  `:296-303,397,416` (`extendLifetime`-dispatched touches), mirror
  `apps/web/src/lib/sw-cache.ts:284-305`, tests `apps/web/src/__tests__/sw-cache.test.ts:513-559`
  (single-actor only)
- Problem: the meta mutation queue serializes individual reads/writes but the
  read-decide-delete sequence is not atomic. A concurrent same-URL request that confirms
  freshness (304/same-ETag) can commit a `touchMeta` between another request's stale read and
  its unconditional `deleteMeta`, so the just-refreshed entry (and its cached bytes) are
  evicted — contradicting the C4-36 recency-authority invariant.
- Failure scenario: two tabs/instances of the same photo, entry past the 1 h stale window, one
  HEAD probe times out (300 ms budget) while the other confirms freshness; the fresh entry is
  discarded, forcing a spurious refetch.
- Suggested fix: make read-decide-delete one `withMetaMutation` operation (re-read inside the
  queued callback, delete meta there when stale), then delete cache bytes based on that atomic
  decision; mirror in `sw-cache.ts`; regenerate + commit `sw.js`; add an interleaved-touch test.

### AGG9B-04 - Bulk edit lets the same tag appear in both add and remove lists; removal silently wins and the audit log lies

- Severity: Medium
- Confidence: High
- Source findings: `CR9-03`
- Citations: `apps/web/src/components/bulk-edit-dialog.tsx:264-287` (two independent TagInputs,
  no cross-field validation), `apps/web/src/app/actions/images.ts:1049-1051` (normalization,
  no overlap check), `:1185-1204` (adds run first, removes run after against the same batch)
- Problem: no client or server check prevents one tag from landing in both lists; the add
  insert is unconditionally undone by the remove delete for every selected image, the action
  returns `{ success: true, count }`, and the `images_bulk_update` audit entry records the tag
  under `addTagNames`.
- Failure scenario: 50-photo bulk edit intending to add `portrait`; a stray autocomplete pick
  also puts it in Remove; all 50 photos silently lose/never gain the tag while the audit trail
  says it was added.
- Suggested fix: reject overlapping normalized tags server-side (mirroring the existing
  `topicMode === 'set' && !topicValue` validation) and surface the same error client-side.

### AGG9B-05 - Cycle-18's TagFilter responsive split mounts every tag chip twice

- Severity: Medium (scales with tag vocabulary; regression introduced at HEAD)
- Confidence: High
- Source findings: `PERF9-01`, `CR9-02` (cross-agent: perf-reviewer + code-reviewer; also
  flagged as a critic risk note)
- Citations: `apps/web/src/components/tag-filter.tsx:62-145` (`chips` fragment rendered inside
  both the `sm:hidden` `<details>` and the `hidden sm:flex` div)
- Problem: both subtrees are always mounted/hydrated/reconciled; N tags now produce 2N+2
  interactive buttons with duplicated handlers on every public listing page. `TagFilter` is not
  memoized and `HomeClient` re-renders on scroll appends and viewport bucketing, so the double
  tree is re-reconciled repeatedly. No a11y impact (`display:none` is out of the AT tree) —
  pure DOM/hydration/reconciliation cost, plus future testing-library ambiguity.
- Suggested fix: single-mount the chips (breakpoint boolean via the `use-display-capability`
  matchMedia idiom) or at minimum `React.memo(TagFilter)` + `useMemo` the chips fragment.

### AGG9B-06 - No admin can revoke a different admin's Lightroom PAT short of deleting the whole account

- Severity: Medium
- Confidence: Medium (may be an intentional per-owner scoping decision, but it is
  inconsistent with the documented full-trust multi-root-admin model)
- Source findings: `SEC9-01`
- Citations: `apps/web/src/lib/admin-tokens.ts:183-190` (`listTokensForUser` filters
  `user_id`), `:242-250` (`revokeToken` requires owning `user_id`),
  `apps/web/src/app/actions/lr-tokens.ts:116-160`
- Problem: PATs are long-lived, origin-check-bypassing bearer credentials, yet list/revoke are
  hard-scoped to the calling admin. The only cross-admin remedy is `deleteAdminUser` (cascades
  ALL of that admin's sessions + tokens and removes their login).
- Failure scenario: admin B's token leaks; admin A cannot kill it without destroying B's
  account; the leaked credential stays live during the gap.
- Suggested fix: per the full-trust model, let any admin list (owner-labeled) and revoke any
  token; or explicitly document per-owner scoping as intentional and add a lighter
  "revoke all tokens for user X" action.

### AGG9B-07 - `restoreDatabase()` drain-checklist orchestration is pinned only by source-text scans

- Severity: High (test gap on the most safety-critical control flow)
- Confidence: High
- Source findings: `TEST9-01`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:545-609`;
  string-slice tests `restore-blocker-messages.test.ts:16-77`, `restore-upload-lock.test.ts:96`,
  `image-queue-quiesce.test.ts:15`
- Problem: the four sequential drain stages + abort-on-timeout contract are never executed by
  any test; each helper has unit tests but the ORCHESTRATION (ordering, early-return, finally
  flag resolution) is proven only by `source.indexOf` slices.
- Failure scenario: a refactor reorders/weakens one `if (!xDrained) return` and a restore
  imports over an in-flight writer — discovered only in production.
- Suggested fix: extract an injectable `runRestoreDrainChecklist(stages)` orchestrator
  (pattern precedent: `computeBackfillExitCode`) and behavior-test each failing stage
  short-circuits before `runRestore()`.

### AGG9B-08 - GPS-strip fail-closed contract on both upload paths is asserted only via source-regex

- Severity: High (privacy-critical guard without executable proof)
- Confidence: High
- Source findings: `TEST9-02`
- Citations: `apps/web/src/app/actions/images.ts` (uploadImages GPS guard),
  `apps/web/src/app/api/admin/lr/upload/route.ts`;
  regex pins `images-action-gps-toggle-wiring.test.ts:69-91`, `lr-upload-hdr-gate.test.ts:24-30,101-105`
- Problem: the delete-original-and-reject behavior when `stripGpsFromOriginal` returns false is
  never executed; position-based `toContain` checks can stay green while runtime behavior
  regresses to persisting GPS or orphaning rows.
- Suggested fix: one behavior test per path (mock `stripGpsFromOriginal` → `false`) asserting
  rejection, no DB insert, and the original-file delete actually invoked.

### AGG9B-09 - `TopicRouteLockTimeoutError` handling (incl. orphaned cover-image cleanup) has zero coverage across all 5 catch sites

- Severity: Medium
- Confidence: High
- Source findings: `TEST9-03`
- Citations: `apps/web/src/app/actions/topics.ts:15-16,75-90` and catch sites ~187-198,
  ~415-432, ~528-545, ~595-609, ~665-680; existing machinery in `topics-actions.test.ts:547-611`
- Problem: `GET_LOCK` returning 0 is never simulated; the lock-timeout cleanup
  (`deleteTopicImage(imageFilename)`) and error-message mapping are unpinned despite the test
  file already having the mock shape for the RELEASE_LOCK-failure sibling.
- Suggested fix: add an `acquired: 0` mock case per action asserting error key, cover-image
  cleanup, and no DB mutation.

### AGG9B-10 - Color/HDR audit UI, semantic search UI, and SW registration have zero e2e coverage

- Severity: Medium
- Confidence: High
- Source findings: `TEST9-04`
- Citations: `apps/web/e2e/*.spec.ts` (8 files; no matches for semantic/histogram/color-details/serviceWorker)
- Problem: three of the product's most distinguishing surfaces are only unit/source-contract
  tested; a hydration or registration failure ships green.
- Suggested fix: narrow Chromium specs — lightbox color-details render, stub-mode semantic
  query round-trip, `navigator.serviceWorker.getRegistration()` active after load.

### AGG9B-11 - Color sidecar's advisory-lock acquisition/contention exit paths are untested

- Severity: Low-Medium
- Confidence: High
- Source findings: `TEST9-05`
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:325-348`
- Problem: the documented "waits up to 10 s, exits non-zero" contract has no test, unlike the
  deliberately-extracted `computeBackfillExitCode` beside it.
- Suggested fix: extract `acquireBackfillLockOrExit` and unit-test acquired-0 / query-throw.

### AGG9B-12 - The `acquireAdminMutationSlot` restore-fence invariant has no automated scanner, unlike its same-origin sibling

- Severity: Medium
- Confidence: High
- Source findings: `ARCH9-03`
- Citations: `apps/web/scripts/check-action-origin.ts` (zero references to the barrier);
  barrier present in 12/13 action files today (only `public.ts` legitimately exempt)
- Problem: `CLAUDE.md` documents the barrier as universal on mutating admin actions
  (C77-ARCH-01 closure), but only manual review enforces it; a 14th action file can omit it and
  reopen the restore-window write race with no CI signal.
- Suggested fix: extend `check-action-origin.ts` (same AST walk) to require the slot acquire or
  an explicit exemption comment; update fixtures.

### AGG9B-13 - `ActionResult<T>` is a dead shared contract; 13 action modules hand-roll incompatible result shapes

- Severity: Low-Medium
- Confidence: High
- Source findings: `ARCH9-01`
- Citations: `apps/web/src/lib/action-result.ts:1-5` (zero consumers); divergent shapes sampled
  across `images.ts`, `embeddings.ts`, `admin-backfill.ts`, `settings.ts`, `public.ts`, `sharing.ts`
- Problem: a canonical type nothing follows invites copy-paste error-shape bugs
  (`if (result.error)` silently passing a `status`-shaped failure). Flagged since archived TD-07.
- Suggested fix: explicit adopt-or-delete decision; cheapest correct move is deleting the dead
  type and documenting the prevailing `status`-discriminant convention.

### AGG9B-14 - `pending-session-revocations.ts` lacks the `globalThis + Symbol.for` reinstantiation guard its six siblings use

- Severity: Low
- Confidence: Medium-High
- Source findings: `ARCH9-02`
- Citations: `apps/web/src/lib/pending-session-revocations.ts:26` (plain top-level `Set`);
  pattern present in `admin-backfill-runner.ts`, `admin-mutation-barrier.ts`,
  `image-queue.ts:100`, `restore-maintenance.ts`, `storage/index.ts:23`, `upload-tracker-state.ts`
- Problem: security-relevant process-local state (queued session-token deletes) can be silently
  reset by module re-evaluation (dev-mode scoped today); no written rule says which state needs
  the guard.
- Suggested fix: apply the ~5-line guard (or document the acceptance + the convention rule in
  CLAUDE.md).

### AGG9B-15 - Photo-viewer Info controls expose open/closed state only via a changing text label

- Severity: Medium (WCAG 4.1.2 Name, Role, Value)
- Confidence: High (live-DOM verified)
- Source findings: `DES9-01`
- Citations: `apps/web/src/components/photo-viewer.tsx:652-667` (desktop pin toggle — no
  `aria-pressed`), `:602-615` (mobile sheet trigger — no `aria-expanded`/`aria-controls`);
  correct in-repo precedents at `lightbox.tsx:634`, `info-bottom-sheet.tsx:301`, `nav-client.tsx:183-184`
- Problem: the one stateful control pair on the page that doesn't follow the codebase's own
  established pattern; screen-reader users cannot programmatically determine panel state.
- Suggested fix: `aria-pressed={isPinned}` on desktop; `aria-expanded={showBottomSheet}` +
  `aria-controls` (add an id to the sheet root) on mobile.

### AGG9B-16 - Cycle-18 plan status/index remain pre-push stale and two cycles of pushed fixes lack any deploy transcript

- Severity: Medium (process/ledger)
- Confidence: High
- Source findings: `VER9-04`, `DOC-C19-02` (cross-agent: verifier + document-specialist)
- Citations: `.context/plans/cycle-18-2026-07-08-plan.md:1-4,133-140` (status
  "COMMIT/PUSH ... IN PROGRESS", WP5 unchecked — but `6efd737b` IS pushed at origin/master),
  `.context/plans/README.md:36` ("at HEAD `a1863405`"); no cycle-17/18 deploy-evidence commit in `git log`
- Problem: pushed-but-undeployed state is not distinguishable from not-pushed; per repo policy
  every push is followed by a deploy, and two cycles of fixes (incl. the PAT ordering fix) have
  no committed production supersession evidence.
- Suggested fix: this cycle's per-cycle deploy supersedes; record deploy evidence in this
  cycle's plan, and reconcile the cycle-18 status/index lines if the peer has not already done
  so by implementation time (peer's cycle-19 is in flight — re-check before editing).

### AGG9B-17 - Carry-forward register header still says `Age @ r10c4` while its checkpoint prose says run-10 c18

- Severity: Low-Medium
- Confidence: High
- Source findings: `DOC-C19-03`
- Citations: `.context/plans/deferred-carry-forward.md:19-27,36-40` (prose "run-10 c18",
  table header `Age @ r10c4`)
- Problem: the age-budget policy is mechanically checkable only through this table; a stale
  age basis undercounts by ~14 cycles and defeats the 8/16-cycle checkpoints.
- Suggested fix: relabel the age column to the current basis (or add an "age as of" column)
  and note the dual-loop sharing convention.

### AGG9B-18 - Unindexed root-level `cycle-19-plan.md`/`cycle-19-deferred.md` collide with the peer loop's live cycle numbering

- Severity: Low-Medium
- Confidence: High
- Source findings: `DOC-C19-04`
- Citations: `.context/plans/cycle-19-plan.md:1-5,52-58` (old completed plan from HEAD
  `5c559a0f`, claims `_aggregate.md` provenance), `.context/plans/cycle-19-deferred.md:1-6`;
  not listed in `.context/plans/README.md`
- Problem: the peer loop is entering its cycle 19 NOW; a lane grepping `cycle-19-*` finds the
  old artifacts and can adopt a stale scope as current.
- Suggested fix: add explicit historical-disambiguation entries to the plans README (renaming
  is riskier while the peer is mid-cycle; index annotation is the safe half).

### AGG9B-19 - `saveOriginalAndGetMetadata` comment overstates heap-safety versus the actual entrypoints

- Severity: Low
- Confidence: High
- Source findings: `DOC-C19-05`
- Citations: `apps/web/src/lib/process-image.ts:882-887` ("avoid materializing up to 200MB on
  the heap") vs `lr/upload/route.ts:180-183` (`request.formData()`) and
  `actions/images.ts:184-260` (framework-materialized `File[]`); `CLAUDE.md` documents the
  buffering truthfully
- Problem: the helper comment implies end-to-end streaming; a reviewer could deprioritize the
  documented multipart RSS risk.
- Suggested fix: reword the comment — the helper avoids an ADDITIONAL full-size copy; framework
  multipart parsing remains the outer memory boundary.

### AGG9B-20 - This loop's cycle-9 artifacts collide in name with the peer run-10 loop's own Cycle 9

- Severity: Low (process hygiene)
- Confidence: High
- Source findings: `CRIT9-03`
- Citations: `.context/plans/cycle-9-2026-07-07-{plan,deferred}.md` (peer run-10's Cycle 9),
  `.context/plans/README.md:38` (the "b"-suffix precedent for loop-B), this cycle's review dir
- Problem: three distinct "Cycle 9" lineages now exist; bare-name greps load the wrong scope.
- Suggested fix: file this cycle's plan/deferred pair as `cycle-9b-2026-07-08-*` per the
  7b/8b precedent and add a README cross-reference.

### AGG9B-21 - `beginDurableRestoreMaintenance` rolls back a maintenance flag it does not own when the marker write fails

- Severity: Medium
- Confidence: High
- Source findings: `CR9-S1` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/lib/restore-maintenance-durable.ts:97-108` (catch calls
  `endRestoreMaintenance()` whenever `started` is true), `apps/web/src/lib/restore-maintenance.ts:48-55`
  (`beginRestoreMaintenance` returns `true` via `allowExisting` even when the flag was ALREADY
  active — i.e. not newly started by this caller), `apps/web/src/app/[locale]/admin/db-actions.ts:511`
  (the only caller, uses `{ allowExisting: true }`)
- Problem: when maintenance is already active (e.g. recovered from a durable marker at boot)
  and `writeDurableRestoreMaintenance()` throws (disk error), the catch clears the
  process-local maintenance flag that a prior owner set — while the on-disk durable marker may
  still exist. State diverges: marker says active, process flag says inactive, so
  uploads/queue/mutations that consult the process flag proceed during a window the durable
  marker claims is maintenance.
- Suggested fix: make the begin call distinguish "newly started" from "already active"
  (return an owned/joined discriminant) and only roll back on the owned path; add a unit test
  for the marker-write-failure-under-allowExisting case.

### AGG9B-22 - `getClientIp` XFF hop selection is off-by-one for standard append-mode proxy chains

- Severity: Medium
- Confidence: Medium-High
- Source findings: `CR9-S2` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/lib/rate-limit.ts:184-194` (`clientIndex = validParts.length - hopCount - 1`),
  `apps/web/nginx/default.conf:110-111` (shipped overwrite-mode: XFF = `$remote_addr`, plus
  X-Real-IP), `:23` (comment pointing operators at `$proxy_add_x_forwarded_for` for chains),
  `CLAUDE.md` TRUSTED_PROXY_HOPS row; pinned by `src/__tests__/rate-limit.test.ts:107-124`
- Problem: the code models the rightmost `hopCount` XFF entries as the trusted proxies' OWN
  addresses. Standard append-mode proxies (`$proxy_add_x_forwarded_for`) each append the PEER
  they accepted from, so a chain behind `hops` trusted proxies ends with the true client at
  index `length - hops`, not `length - hops - 1`. Consequences under the documented CDN
  topology (hops=2, append mode): an honest chain (`client, cdn`) yields `clientIndex = -1`
  and every visitor collapses into the CDN's X-Real-IP bucket; a client that prepends one junk
  entry gets `clientIndex = 0` = attacker-controlled → per-IP rate-limit bypass. The SHIPPED
  nginx-overwrite config is safe only via the X-Real-IP fallback (XFF has 1 entry, index -1).
- Suggested fix: select `validParts[validParts.length - hopCount]` (reject chains shorter than
  `hopCount`), update the tests + the code comment + the CLAUDE.md hop-semantics row together,
  and keep indexing on the raw right-anchored positions so a filtered invalid entry cannot
  shift the client slot.

### AGG9B-23 - Lightbox slideshow Pause button is defeated on touch devices

- Severity: High (UX; touch users cannot stop a running slideshow via the control)
- Confidence: High
- Source findings: `CR9-S3` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/components/lightbox.tsx:247-263` (container-level `handleTouchEnd`
  unconditionally `setIsSlideshowActive(false)` on every touch), `:489-490` (handlers on the
  root container — touch events bubble up from the buttons), `:627-631` (Pause/Play `onClick`
  does `setIsSlideshowActive(prev => !prev)`; its `stopPropagation` affects the CLICK, not the
  earlier touchend)
- Problem: tapping Pause while the slideshow is active fires touchend first (container sets
  active=false), then click toggles `prev => !prev` back to TRUE — net: still playing. Tapping
  Play works (false→false, then toggle→true), so the asymmetry silently breaks only the pause
  direction. Space is unavailable on mobile, so there is no touch path to stop the slideshow
  except closing the lightbox.
- Suggested fix: in `handleTouchEnd` (and the touchstart-stop path if any), skip the
  slideshow-stop when the event target is inside an interactive control
  (`(e.target as Element).closest('button')`), or only stop the slideshow when the gesture
  actually qualifies as a swipe.

### AGG9B-24 - Image-zoom double-tap races the browser's native double-tap zoom when un-zoomed

- Severity: Medium
- Confidence: Medium
- Source findings: `CR9-S4` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/components/image-zoom.tsx:380` (`touchAction: isZoomed ? 'none' : 'auto'`),
  `:216-236` (double-tap toggle in a React synthetic touchend with `e.preventDefault()`)
- Problem: while un-zoomed, `touch-action: auto` leaves the browser's own double-tap-to-zoom
  gesture armed; whether the synthetic touchend `preventDefault()` beats the native gesture is
  browser-dependent (and mobile browsers may also add the 300 ms click delay). The custom
  "double-tap the eye" anchor zoom can lose the race and page-zoom instead.
- Suggested fix: use `touch-action: manipulation` for the un-zoomed state (keeps scroll/pan,
  removes double-tap zoom + click delay deterministically), `none` when zoomed as today.

### AGG9B-25 - "Inert Toaster" report could not be confirmed from source (manual-validation risk)

- Severity: Low-Medium (as relayed; unconfirmed)
- Confidence: Low (needs manual validation)
- Source findings: `CR9-S5` (reconstructed sub-sweep relay)
- Citations: `apps/web/src/app/[locale]/layout.tsx:149` (single `<Toaster />` mount inside
  ThemeProvider), `apps/web/src/components/ui/sonner.tsx` (closeButton + 6 s duration),
  callers in lightbox/photo-viewer/load-more/image-manager/admin-user-manager/upload-dropzone
- Status: the aggregating lane could not reproduce an "inert" toaster from source: the mount
  is unique, inside the provider tree, and `toast()` call sites are wired. Possible residual
  angle: toast reachability/announcement while the modal lightbox (`aria-modal`, focus-trapped)
  is open. Recorded as a needs-browser-validation risk, not a confirmed defect.

### AGG9B-26 - The ICC-description HDR/gamma heuristic branch is dead code (only call site passes null)

- Severity: Medium
- Confidence: High
- Source findings: `CR9-S6` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/lib/color-detection.ts:364` (`inferTransferFunction(iccName, null, bitDepth)`
  — the ONLY call site), `:80-102` (every `desc.includes(...)` check — PQ "st 2084"/"smpte 2084",
  HLG "hybrid log"/"arib", "gamma 2.2"/"gamma 1.8"/"linear" — operates on the always-empty string)
- Problem: the documented heuristic ("PQ and HLG transfer functions in the ICC description are
  treated as HDR", file header lines 9-10) is only half-wired: description-only HDR hints
  (e.g. a profile whose NAME lacks pq/hlg but whose description says "SMPTE 2084") never
  match, so the `allow_hdr_ingest=false` upload rejection can miss ICC-desc-labeled HDR
  sources that carry no NCLX. Alternatively the parameter is redundant and should be removed
  so the code stops implying coverage it does not have.
- Suggested fix: either wire the actual extracted ICC descriptor through the call site, or
  delete the `iccDescription` parameter + desc branches and correct the header comment; add a
  test for whichever contract is chosen.

### AGG9B-27 - Image-manager tag chips show stale state until the router.refresh round-trip completes

- Severity: Medium
- Confidence: High
- Source findings: `CR9-S7` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/components/image-manager.tsx:504-533` (`selectedTags` derives
  solely from the server-provided `image.tag_names`; `onTagsChange` fires the server action
  then `router.refresh()`; no local/optimistic state)
- Problem: after adding/removing a tag the chips keep rendering the OLD tag list for the whole
  server-action + refresh round-trip; on slow connections the UI appears to ignore the edit
  (invites double-submits), and on action failure there is no visual revert cue beyond the toast.
- Suggested fix: keep a local optimistic tag list per row (seeded from the prop, updated in
  `onTagsChange`, reverted on failure) or at least disable the input while the mutation is in
  flight.

### AGG9B-28 - Cmd/Ctrl+K cannot close the search dialog because the toggle self-blocks on the dialog's own input

- Severity: Low-Medium
- Confidence: High
- Source findings: `CR9-S8` (reconstructed sub-sweep; source-verified)
- Citations: `apps/web/src/components/search.tsx:327-331` — the handler toggles
  (`setIsOpen(prev => !prev)`) but early-returns when `e.target` is an
  `HTMLInputElement`/`HTMLTextAreaElement`; the open search dialog focuses its own input, so
  the shortcut is inert exactly when the dialog is open
- Problem: the guard exists to avoid hijacking Cmd+K while typing in unrelated inputs, but it
  also swallows the toggle from the search box itself — the standard close gesture
  (Cmd/Ctrl+K again) does nothing; only Escape works.
- Suggested fix: allow the toggle when the focused element is the search dialog's own input
  (compare against a ref) while keeping the guard for all other inputs.

## Refuted / Clean Areas (evidence recorded in the lane files)

- verifier: all four spot-checked cycle-18 closures (PAT wrapper split + behavior tests,
  CLIP/pipeline doc contracts, mobile tag disclosure, ledger WP1 acceptance) are genuinely
  closed at HEAD; test-file count matches the plan's claimed run.
- tracer: admin-mutation barrier marker/slot ordering CONFIRMED CORRECT (full synchronous
  argument); the new color-backfill settings lock follows the destroy-on-acquire-error
  discipline; the `markAdminAuthTokenUsed` WeakMap/WeakSet lifecycle has no double-mark or
  premature-clear regression.
- debugger: gain-map/GPS-strip/ICC-chromaticity binary walkers, db-child-watchdog,
  single-writer-guard, blur-data-url, migrate.js DML guard, retryFailedImage rollback — all
  re-read in full, no new defects.
- security-reviewer: no new HIGH/CRITICAL exploitable weakness; per-surface evidence recorded
  (origin fail-closed, session fixation, serve-upload containment, OG SSRF pinning,
  smart-collections compiler, PII select guards, CSV/LIKE escaping, restore child-process
  spawning, CSP, lint-gate coverage vs file inventory).
- designer: no new sub-44 touch targets, no missing alt/label, no i18n drift; map a11y and
  tag-input combobox re-verified correct.

## AGENT FAILURES

None.
