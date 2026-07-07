# Run-10 Cycle 9 (loop-B) Deferred Findings — 2026-07-08

Aggregate: `.context/reviews/cycle-9-2026-07-08/_aggregate.md` (28 findings; every finding
is either scheduled in `cycle-9b-2026-07-08-plan.md` or recorded here — none dropped).

Rules honored: severities/confidences preserved from the review lanes (no downgrades to
justify deferral); every deferral cites file+line, reason, and exit criterion. No
security, correctness, or data-loss finding is deferred below — each row is a
test-infrastructure investment, a perf redesign below the measured-impact bar, or a
manual-validation item, consistent with the repo's precedent rows
(`deferred-carry-forward.md` C94-04/05, C4-18, C2-55). Deferred work remains bound by repo
policy when picked up (GPG-signed conventional+gitmoji commits, no `--no-verify`,
`git pull --rebase` before push, no force-push, Node 24+/TS 6, full gates).

## D9b-01 — AGG9B-10 / TEST9-04: e2e coverage for color-audit UI, semantic search UI, SW registration

- **Severity/Confidence:** MED / High.
- **Citation:** `apps/web/e2e/*.spec.ts` (8 files; zero matches for
  semantic/histogram/color-details/serviceWorker); product surfaces
  `components/color-details-section.tsx`, `lightbox-color-pip.tsx`, `histogram.tsx`,
  semantic search UI, `public/sw.template.js`.
- **Reason:** the three specs need e2e-infrastructure the default lane does not have today:
  a seeded wide-gamut/HDR fixture photo (current seed is 2 sRGB smoke photos), a DB
  `semantic_search_mode='stub'` settings row in the e2e database, and a production-build
  server for SW registration (`register-service-worker` behavior differs under the dev
  server) — same investment class as the open C94-04/C4-18 harness rows and the peer's
  deferred `AGG-C18-08` browser-matrix expansion.
- **Exit criterion:** the next e2e-infrastructure cycle (or the peer's AGG-C18-08 exit
  firing) adds the seeded fixture + stub-mode row + prod-build lane; any real regression in
  these three surfaces re-opens immediately as a scheduled item.

## D9b-02 — AGG9B-11 / TEST9-05: color sidecar advisory-lock exit paths untested

- **Severity/Confidence:** LOW-MED / High.
- **Citation:** `apps/web/scripts/backfill-color-pipeline.ts:325-348` (`GET_LOCK(?, 10)`,
  `process.exit(1)` on query failure / `!lockAcquired`).
- **Reason:** operator-run `--rm` sidecar where a bad exit is loud and operator-visible,
  not silent data damage; this cycle's test budget goes to the HIGH-severity restore-drain
  (WP7) and GPS fail-closed (WP8) gaps. The fix pattern (`computeBackfillExitCode`-style
  extraction) is documented in the finding for whoever picks it up.
- **Exit criterion:** the next cycle touching `backfill-color-pipeline.ts` folds the
  extraction + unit test (C1-32 incremental-drainage policy), OR any incident where the
  sidecar proceeded without the lock.

## D9b-03 — AGG9B-25 / CR9-S5: "inert Toaster" relay — unconfirmed, needs browser validation

- **Severity/Confidence:** LOW-MED (as relayed) / LOW (could not be confirmed from source).
- **Citation:** `apps/web/src/app/[locale]/layout.tsx:149` (single mount, inside providers),
  `apps/web/src/components/ui/sonner.tsx`; `toast()` call sites across
  lightbox/photo-viewer/load-more/image-manager/admin-user-manager/upload-dropzone.
- **Reason:** the aggregating lane could not reproduce any inert behavior from source; the
  only residual hypothesis (toast reachability/announcement while the `aria-modal`
  focus-trapped lightbox is open) requires a live browser/AT check, which this cycle's
  designer lane did not observe as a defect either.
- **Exit criterion:** the next credentialed/browser-validation pass (same trigger as the
  peer's AGG-C18-21) explicitly checks toast visibility + keyboard reachability with the
  lightbox open; a confirmed repro re-opens this as a scheduled fix.

## D9b-04 — AGG9B-05 (residual half): TagFilter single-mount responsive redesign

- **Severity/Confidence:** MED / High (finding); residual half only.
- **Citation:** `apps/web/src/components/tag-filter.tsx:62-145` (dual-mount `<details>` +
  `sm:flex` trees).
- **Reason for partial deferral:** WP5 ships the memoization half (halts the repeated
  re-reconciliation cost). Replacing the dual-mount with a breakpoint-driven single mount
  changes SSR/first-paint semantics of the peer loop's one-cycle-old accessibility fix
  (AGG-C18-15) — redesigning a peer surface mid-flight risks conflict and regression for a
  DOM-size win with no measured symptom at current tag counts.
- **Exit criterion:** measured hydration/DOM cost at a real large tag vocabulary, OR the
  next cycle that redesigns the tag filter (either loop) folds the single-mount in.

## D9b-05 — AGG9B-08 (conditional residual): `uploadImages()` GPS fail-closed behavioral harness

- **Severity/Confidence:** HIGH / High (test gap; underlying code verified by source pins).
- **Citation:** `apps/web/src/app/actions/images.ts` GPS-strip guard;
  `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts:14-18` (its own header
  documents the heavy-mock trade-off).
- **Reason:** recorded ONLY if WP8's attempt at the server-action harness proves too
  brittle this cycle (the LR-route half ships regardless — its POST-handler harness already
  exists). This is the same server-action mocking-surface investment as the open D8b-02 row
  (upload-quota TOCTOU harness) and shares its justification.
- **Exit criterion:** same as D8b-02 — a reusable server-action behavioral harness lands,
  OR any regression/incident traced to the GPS fail-closed path fires an immediate re-open.
  If WP8 lands the action-half test this cycle, this row is void (record in the plan).

## Age-budget check (run-10 loop-B cycle 9)

- **8-cycle High budget:** the orchestrator flagged run-10 cycle-2 deferrals as reaching
  age 8 this cycle. Mechanical check of `cycle-2-2026-07-07-deferred.md`: it contains NO
  High-severity rows (C2-12 is "Medium, escalates toward High at scale"; all others are
  Medium or lower), so no row is forced to schedule-or-reclassify by the High rule.
  C2-12 (map markers) is additionally already re-justified under the peer's active register
  as `AGG-C18-05` (Medium, exit criteria preserved) — not re-listed verbatim here.
- **16-cycle MED checkpoint:** cycle-2 MED rows are at ~8 review cycles — below the
  16-cycle checkpoint; no re-justification forced yet.
- **Loop-B's own register (cycle-8b):** D8b-01..07 are 1 cycle old; D8b-02 (HIGH test-infra)
  stays open with its exit criterion unchanged; D9b-05 above chains it rather than
  duplicating.
- The consolidated `deferred-carry-forward.md` gains this cycle's D9b rows and the
  age-basis label refresh via WP14.
