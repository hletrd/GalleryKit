# Plan 342 — Run-9 Cycle-3 deferred / record-only findings (cycle 6/100)

**Source:** `.context/reviews/_aggregate.md` (run-9 cycle-3 fan-out, 11 agents; one recovered test-engineer write-failure — findings preserved). HEAD at planning time: `4c3d5924`.
**Rule basis (STRICT, per the cycle's deferred-fix policy):** Every review finding is either scheduled in `plan-341-run9-cycle3-fixes.md` or recorded HERE. No finding is silently dropped. Each entry below preserves the ORIGINAL severity/confidence (never downgraded to justify deferral), a file+line citation, a concrete deferral reason, and an exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY when CLAUDE.md explicitly permits, with the rule quoted. Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, Node 24+/TS6).

> This list is ONLY for existing review findings. No new refactors/features are introduced under "deferred."

> **NOTE on the one correctness finding this cycle (AGG-C6-01, WebP RIFF field-order):** it is NOT deferred — it is SCHEDULED in plan-341 Item 1. It is also NOT a security/privacy/data-loss finding (the `null` fallback re-encode still strips GPS; security-reviewer assessed it out of scope), so it would have been deferrable, but the fix is small so it is being done this cycle. No correctness/security/data-loss finding is deferred this cycle.

---

## Deferred 1 — AGG-C6-03 part 2 / AGG-C5-03 part 2: durable touch-target audit rule for bare inline `<Link>`/`<a>`

- **Severity/Confidence (original, preserved):** MED / High (the live a11y defects — the specific links — are SCHEDULED: the three cycle-5 links in plan-339 Item 3, the two cycle-6 links in plan-341 Item 3; ONLY the durable audit-hardening is deferred here).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:440-466` — the `<Link>`/`<a>` FORBIDDEN patterns fire only on an EXPLICIT sub-44 sizing token; a bare inline link with no height token is out of scope by design (committed comment `:437-438`: "sr-only skip links … and plain text links never trip").
- **Reason for deferral:** UNCHANGED from plan-340 Deferred-1. A "bare link has no height token ⇒ flag it" rule would FALSE-POSITIVE every link that legitimately inherits >=44 px from a sized flex/grid parent. A correct heuristic (flag interactive `<Link>`/`<a>` whose className has NO sizing token AND is NOT inside a sized flex/grid parent) is high engineering cost — the scanner is regex/source-text based with no DOM/layout model. The CONCRETE live links are fixed in plan-341 Item 3 (+ plan-339 Item 3 last cycle); this entry is only the structural blind-spot. NOT a correctness/security/data-loss finding (it's test-gate coverage; the underlying a11y defects are being fixed). **This cycle's AGG-C6-03 is direct evidence the blind spot keeps producing new instances** (two more bare back-nav links found) — but the cost/false-positive tradeoff of the full heuristic is unchanged, so the pragmatic per-link positive-pin (taken in plan-339/341) remains the accepted mitigation until a dedicated audit-hardening pass.
- **Exit criterion:** re-open when a dedicated audit-hardening / UI-polish pass is scheduled, OR when the recurrence rate justifies the engineering cost (this is now the THIRD cycle finding bare-link instances — c5 found 3, c6 found 2; if c7+ finds more, escalate the cost/benefit). Pragmatic middle path (near-zero cost, taken opportunistically in plan-341 Item 3): add the fixed links to the existing positive-assertion `it` block so a future tap-area drop is caught. The full layout-aware heuristic remains deferred until the audit gains parent-context awareness or the cost is explicitly accepted.

## Deferred 2 — AGG-C6-R1 / AGG-C5-R1: color-pipeline writer consolidation (WI-09 `applyColorPipelineResult()`)

- **Severity/Confidence (original, preserved):** MED / (maintainability) — architect.
- **Where:** `apps/web/src/lib/image-queue.ts` (upload, splits the concern — color cols at INSERT in `apps/web/src/app/actions/images.ts:340-360`, derivative flags at the queue UPDATE `:368-371`) ↔ `apps/web/src/lib/admin-backfill-runner.ts` (in-app, Writer B) ↔ `apps/web/scripts/backfill-color-pipeline.ts` (sidecar, Writer C). True duplication B↔C (~120 LOC).
- **Reason for deferral:** UNCHANGED from plan-340 Deferred-2. The duplication is CONVERGING, not drifting — the two backfill paths re-confirmed BYTE-EQUIVALENT this cycle (architect re-diffed at source: same 10-column UPDATE set, same `[]`-dir-scan cleanup contract, same detection-failure semantics). The cycle-5 sidecar test added two narrow module-level test seams (`cleanupDeletedMidReencodeVariants`, `collectDeletedMidReencodeFiles`) consumed ONLY by the new test — these are the lowest-coupling option and WI-09 will absorb them for free. Consolidation is a maintainability INVESTMENT, not a correctness fix; a rushed same-cycle refactor risks re-introducing a divergence the tests don't yet cover. NOT a correctness/security/data-loss finding (the paths are currently correct and test-locked).
- **Exit criterion:** UNCHANGED — re-open as a dedicated WI-09 refactor when color-pipeline work is next scheduled: extract `applyColorPipelineResult(tx, id, signals, decision)` owning the 10-column write + the `affectedRows===0 → cleanupDeletedMidReencode(…, [])` contract + the detection-failure (derivative-only, no version bump) branch, have all three call sites use it, anchor ONE cross-site test. Until then the comment-coupled duplication is correct and locked by `backfill-color-pipeline.test.ts` + `admin-backfill-runner-*.test.ts` + the new `backfill-color-pipeline-deleted-mid-reencode.test.ts`.

## Deferred 3 — AGG-C6-R2 / AGG-C5-R2: `lib/api-auth.ts` → `@/app/actions/auth` layering inversion

- **Severity/Confidence (original, preserved):** LOW / (arch) — architect (re-affirmed; authoritative re-scan still finds exactly ONE inversion, no cycle).
- **Where:** `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — the SOLE `lib`→`app` import.
- **Reason for deferral:** UNCHANGED from plan-336/338/340. Single, well-contained inversion; no import cycle, no runtime hazard; it is the documented central auth wrapper. Refactoring has no behavioral payoff this cycle. NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open if a SECOND `lib`→`app` inversion appears (drift signal) or if `isAdmin` is relocated for another reason — then move the auth predicate into `lib/`.

## Deferred 4 — AGG-C6-R3 / AGG-C5-R3: `COLOR_IMPACTING_KEYS` hand-maintained, not derived

- **Severity/Confidence (original, preserved):** LOW / (arch hardening) — architect.
- **Where:** `apps/web/src/lib/settings-hash.ts:37-49` — `COLOR_IMPACTING_KEYS` is a hand-maintained 9-element `as const` array (5 color + 3 quality + `image_sizes`), not derived from `GalleryConfig`. (CLAUDE.md:263 cite verified CORRECT at 9 this cycle; the verifier's "10" was a miscount, reconciled against the literal array — the doc is accurate, NO finding there.)
- **Reason for deferral:** UNCHANGED. Deriving the set from the config type is a hardening improvement with no current defect (the list is correct and the settings-hash test pins it). NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open if a new color-/quality-/size-impacting setting is added and the maintainer forgets to add it here (ETag would not invalidate on that setting) — at which point derive the set from `GalleryConfig` keys tagged color-impacting.

## Deferred 5 — AGG-C6-R4 / AGG-C5-R4: `@/lib/storage` dead seam

- **Severity/Confidence (original, preserved):** LOW — architect.
- **Where:** `apps/web/src/lib/storage/**` (~390 LOC) — consumed only by its own index + a test; honestly self-documented as unwired (CLAUDE.md: "Storage Backend (Not Yet Integrated)").
- **Reason for deferral:** UNCHANGED. Interface-rot risk only; no live defect. Removing it would discard the abstraction; wiring it is a feature, not a review fix.
- **Exit criterion:** re-open when S3/MinIO storage is actually wired (validate the interface against real fs call sites at that time) OR if the dead code is deliberately removed.

## Deferred 6 — AGG-C6-R5 / AGG-C5-R5: perf record-only (all documented-intentional)

- **Severity/Confidence (original, preserved):** LOW — perf-reviewer (all byte-identical at HEAD, re-verified this cycle).
- **Where / items:** SW metadata lost-update (`public/sw.template.js`, PERF-L1, best-effort cache by design); bootstrap `notInArray` over ≤1000 failed IDs (PERF-L2, happy-path zero-cost); decode-per-format ~18/image (WI-14 correctness tradeoff); Atom feed filesort (bounded by FEED_LIMIT+cache); timeline non-sargable YEAR()/MONTH() (bounded by LIMIT); single-pool/10 + single-writer topology.
- **Reason for deferral:** UNCHANGED — all DOCUMENTED-INTENTIONAL, none regressed, none a live defect.
- **Exit criterion:** re-open per-item only if the bounding assumption breaks (e.g. SW cache needs a hard 50 MB CAS guarantee; failed-ID set exceeds 1000; feed/timeline outgrows its LIMIT bound; the deployment is horizontally scaled).

## Deferred 7 — AGG-C6-R6 / AGG-C5-R6: designer UI-polish trio (DES-C5-2/3/4)

- **Severity/Confidence (original, preserved):** LOW — designer (re-confirmed OPEN, NOT re-escalated).
- **Where:**
  - **DES-C5-2:** `apps/web/src/components/nav-client.tsx:85,93,122,155,168` — theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible:ring` (UA-default outline still applies, so NOT a hard WCAG 2.4.7 failure — visually inconsistent vs ~29 ring sites).
  - **DES-C5-3:** `apps/web/src/components/lightbox-color-pip.tsx:237` `text-white/50` gamut suffix = 5.15:1 (passes 4.5:1, thinnest margin); `apps/web/src/components/histogram.tsx:691` `decoration-muted-foreground/40` dotted-underline ~2:1 affordance cue.
  - **DES-C5-4:** `apps/web/src/components/photo-viewer.tsx:816` topic Badge renders the raw topic slug rather than a humanized label.
- **Reason for deferral:** UNCHANGED from plan-336/340. Cosmetic/consistency polish; none is a hard WCAG failure or a functional defect. Best fixed together in a dedicated UI-polish pass to avoid scattered one-line churn.
- **Exit criterion:** re-open when a UI-polish pass is scheduled, OR if any becomes a hard failure (e.g. a focus-ring removal elsewhere makes the nav inconsistency a 2.4.7 violation, or the color-pip margin drops below 4.5:1).

## Deferred 8 — AGG-C6-R7 / AGG-C5-R7: SW lost-update + real-encode test isolation + gain-map dead-code note

- **Severity/Confidence (original, preserved):** LOW — debugger/perf-reviewer/test-engineer (all re-confirmed OPEN).
- **Where / items:**
  - **SW image-cache metadata lost-update:** `public/sw.template.js` — whole-doc overwrite, no CAS (best-effort cache by design; same as PERF-L1).
  - **Real-encode test isolation (AGG-C4-T2 / AGG-R8c3-09):** the four real-AVIF/WebP tests in `strip-gps-from-original.test.ts` + the documented `backfill-color-pipeline` / `process-image-color-roundtrip` libheif cold-flake write derivatives into the shared `public/uploads/{avif,webp,jpeg}` and rely on `afterAll` unlink; no per-test `mkdtemp` isolation of the OUTPUT dir.
  - **Gain-map dead-code note (DBG-C6 record-only):** `apps/web/src/lib/gain-map-detection.ts:87` — `readNullTerminatedAscii` has an unreachable `if (p > limit) return ''` guard (the `while (p < limit)` loop guarantees `p <= limit` on exit). Harmless dead branch, no impact.
- **Reason for deferral:** UNCHANGED. SW lost-update is best-effort by design (no data-loss — it's a cache); the test-isolation cold-flake has not reproduced across the recent cycles (did not reproduce this cycle either); the gain-map guard is harmless dead code. None is a correctness/security/data-loss finding.
- **Exit criterion:** SW — re-open if a hard 50 MB cap or exact-metadata guarantee is required. Test isolation — re-open if the cold-flake reproduces in CI (isolate the OUTPUT dir per test via `mkdtemp` + a configurable `UPLOAD_DIR_*` override). Gain-map dead code — remove opportunistically if `gain-map-detection.ts` is next edited (zero-risk one-line deletion); not worth a standalone commit.

## Deferred 9 — AGG-C6-T1: direct `stripGpsFromIsobmffBuffer` pure-scrubber test (CONDITIONAL)

- **Severity/Confidence (original, preserved):** LOW / Medium — test-engineer.
- **Where:** `apps/web/src/__tests__/strip-gps-from-original.test.ts:104-114` (AVIF) — dispatcher-level test, no direct `stripGpsFromIsobmffBuffer` pure-scrubber test.
- **Reason for deferral:** CONDITIONAL — this is scheduled as OPTIONAL plan-341 Item 6 (bundle with the WebP test). If the implementer takes it there, this entry is satisfied. If cycle budget does not allow, it is deferred here: the AVIF path is NOT currently known-broken, and its decoded-pixel proxy assertion has more teeth than WebP's (the q90 fallback IS lossy, so a silent break is more likely to surface). NOT a correctness/security/data-loss finding (no known bug on the AVIF path — unlike WebP, which IS scheduled).
- **Exit criterion:** re-open (or take in plan-341 Item 6) the next time `gps-exif-strip.ts` ISOBMFF path or `strip-gps-from-original.test.ts` is touched; add a direct `stripGpsFromIsobmffBuffer` pure-scrubber test asserting file-byte identity outside the EXIF/XMP item, for symmetry with the new WebP + existing JPEG pure-scrubber tests.

---

## Cosmetic record-only (no plan entry needed; documented for provenance)

- **TRCR-C6-01** (tracer): under `BACKFILL_CONCURRENCY ≥ 2`, the sidecar's in-flight `processed` counter can be briefly inflated by up to the batch size before `flushBatch` applies its `processed--` correction. The FINAL summary is correct. Log-accuracy only — no orphan, no data issue, no action.

## Progress log

- 2026-06-13 — Plan created from `_aggregate.md` cycle-6 (run-9 cycle-3). HEAD `4c3d5924`. 9 deferred entries (1 new bare-link-recurrence note, 8 carried forward UNCHANGED or conditionally satisfied by plan-341). No correctness/security/data-loss finding deferred (AGG-C6-01 is scheduled in plan-341 Item 1).
