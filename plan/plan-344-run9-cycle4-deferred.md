# Plan 344 — Run-9 Cycle-4 deferred / record-only findings (orchestrator cycle 7/100)

**Source:** `.context/reviews/_aggregate.md` (cycle-7 fan-out, 11 agents; one recovered read-only perf-reviewer Write — findings preserved). HEAD at planning time: `d0920957`.
**Rule basis (STRICT, per the cycle's deferred-fix policy):** Every review finding is either scheduled in `plan-343-run9-cycle4-fixes.md` or recorded HERE. No finding is silently dropped. Each entry preserves the ORIGINAL severity/confidence (never downgraded to justify deferral), a file+line citation, a concrete deferral reason, and an exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY when CLAUDE.md explicitly permits, with the rule quoted. Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, Node 24+/TS6).

> This list is ONLY for existing review findings. No new refactors/features are introduced under "deferred."

> **NOTE on the two MED findings this cycle:** both are SCHEDULED in plan-343 (Item 1 admin-header a11y; Item 2 WebP XMP test gap). Neither is deferred. AGG-C7-02 is a TEST gap on a branch that is proven correct today — it is NOT a live security/privacy/data-loss bug — but it is being done this cycle anyway because it guards the paid-download privacy contract. No correctness/security/data-loss finding is deferred this cycle.

---

## Deferred 1 — AGG-C7-03 part 2 / recurring: durable touch-target audit rule for bare inline `<Link>`/`<a>`

- **Severity/Confidence (original, preserved):** MED / High (the live a11y defects — the specific links — are SCHEDULED: the cycle-7 admin-header link in plan-343 Item 1, the cycle-6 links in plan-341 Item 3, the cycle-5 links in plan-339 Item 3; ONLY the durable audit-hardening is deferred here. The scale-token catch-all gap on Link/a/select IS scheduled in plan-343 Item 3 — that is the regex-pattern hardening; this entry is the separate layout-aware "bare link with NO sizing token" heuristic).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:438-472` — the `<Link>`/`<a>` FORBIDDEN patterns fire only on an EXPLICIT sizing token; a bare inline link with NO height token is out of scope by design (committed comment: "sr-only skip links … and plain text links never trip").
- **Reason for deferral:** UNCHANGED from plan-342 Deferred-1. A "bare link has no height token ⇒ flag it" rule would FALSE-POSITIVE every link that legitimately inherits ≥44 px from a sized flex/grid parent. A correct heuristic (flag interactive `<Link>`/`<a>` whose className has NO sizing token AND is NOT inside a sized flex/grid parent) is high engineering cost — the scanner is regex/source-text based with no DOM/layout model. The CONCRETE live links are fixed in plan-343 Item 1 (+ plan-341/339 prior); this entry is only the structural blind-spot. NOT a correctness/security/data-loss finding (it's test-gate coverage; the underlying a11y defects are being fixed). **Recurrence is DECREASING:** c5 found 3, c6 found 2, c7 found 1 (the admin-header twin, which the two exhaustive sweeps confirm is the LAST instance). The cost/false-positive tradeoff of the full heuristic is unchanged and still not met; the pragmatic per-link positive-pin remains the accepted mitigation.
- **Exit criterion:** re-open when a dedicated audit-hardening / UI-polish pass is scheduled, OR if the recurrence rate REVERSES and starts climbing again (c5=3 → c6=2 → c7=1 is converging toward zero; if c8+ finds NEW bare-link instances after Item 1 closes the admin twin, re-evaluate). Pragmatic middle path (near-zero cost, taken opportunistically in plan-343 Item 1): add the fixed link to the existing positive-assertion `it` block so a future tap-area drop is caught. The full layout-aware heuristic remains deferred until the audit gains parent-context awareness or the cost is explicitly accepted.

## Deferred 2 — AGG-C7-R1: color-pipeline writer consolidation (WI-09 `applyColorPipelineResult()`)

- **Severity/Confidence (original, preserved):** MED / (maintainability) — architect.
- **Where:** 5 color-column INSERT/UPDATE touchpoints — browser INSERT `apps/web/src/app/actions/images.ts:350`, the queue UPDATE in `apps/web/src/lib/image-queue.ts`, the LR PAT-upload INSERT `apps/web/src/app/api/admin/lr/upload/route.ts:376` (deliberately-mirrored parallel writer from US-P53, last touched `f3d68197`, NOT new this cycle), and the two backfill writers `apps/web/src/lib/admin-backfill-runner.ts:559` + `apps/web/scripts/backfill-color-pipeline.ts:370`. True duplication is the two backfill paths (~120 LOC), re-confirmed BYTE-EQUIVALENT this cycle.
- **Reason for deferral:** UNCHANGED from plan-340/342 Deferred-2. The duplication is CONVERGING, not drifting — architect re-diffed at source: same 10-column UPDATE set, same `[]`-dir-scan cleanup contract, same detection-failure semantics. The cycle-5 sidecar test seams (`cleanupDeletedMidReencodeVariants`, `collectDeletedMidReencodeFiles`) are the lowest-coupling option and WI-09 will absorb them for free. `scripts/backfill-cicp-recheck.ts` matched the grep but is read-only (diagnostic, never writes) — not a 6th writer. Consolidation is a maintainability INVESTMENT, not a correctness fix; a rushed same-cycle refactor risks re-introducing a divergence the tests don't yet cover. NOT a correctness/security/data-loss finding (the paths are currently correct and test-locked).
- **Exit criterion:** UNCHANGED — re-open as a dedicated WI-09 refactor when color-pipeline work is next scheduled: extract `applyColorPipelineResult(tx, id, signals, decision)` owning the 10-column write + the `affectedRows===0 → cleanupDeletedMidReencode(…, [])` contract + the detection-failure (derivative-only, no version bump) branch, have all touchpoints use it, anchor ONE cross-site test. Until then the comment-coupled duplication is correct and locked by `backfill-color-pipeline.test.ts` + `admin-backfill-runner-*.test.ts` + `backfill-color-pipeline-deleted-mid-reencode.test.ts`.

## Deferred 3 — AGG-C7-R2: `lib/api-auth.ts` → `@/app/actions/auth` layering inversion

- **Severity/Confidence (original, preserved):** LOW / (arch) — architect (re-affirmed; authoritative re-scan still finds exactly ONE inversion, no cycle).
- **Where:** `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — the SOLE `lib`→`app` import.
- **Reason for deferral:** UNCHANGED from plan-336/338/340/342. Single, well-contained inversion; no import cycle, no runtime hazard; it is the documented central auth wrapper. Refactoring has no behavioral payoff this cycle. NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open if a SECOND `lib`→`app` inversion appears (drift signal) or if `isAdmin` is relocated for another reason — then move the auth predicate into `lib/`.

## Deferred 4 — AGG-C7-R3: `COLOR_IMPACTING_KEYS` hand-maintained, not derived

- **Severity/Confidence (original, preserved):** LOW / (arch hardening) — architect.
- **Where:** `apps/web/src/lib/settings-hash.ts:37-48` — `COLOR_IMPACTING_KEYS` is a hand-maintained 9-element `as const` array (5 color + 3 quality + `image_sizes`), not derived from `GalleryConfig`. (CLAUDE.md:263 verified CORRECT at 9 this cycle by architect + document-specialist; the brief's "5" paraphrase was a stale-snapshot artifact — the on-disk doc is accurate, NO finding there.)
- **Reason for deferral:** UNCHANGED. Deriving the set from the config type is a hardening improvement with no current defect (the list is correct and the settings-hash test pins it). NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open if a new color-/quality-/size-impacting setting is added and the maintainer forgets to add it here (ETag would not invalidate on that setting) — at which point derive the set from `GalleryConfig` keys tagged color-impacting.

## Deferred 5 — AGG-C7-R4: `@/lib/storage` dead seam

- **Severity/Confidence (original, preserved):** LOW — architect.
- **Where:** `apps/web/src/lib/storage/**` (~390 LOC) — zero production importers (consumed only by its own index + a test); honestly self-documented as unwired (CLAUDE.md: "Storage Backend (Not Yet Integrated)").
- **Reason for deferral:** UNCHANGED. Interface-rot risk only; no live defect. Removing it would discard the abstraction; wiring it is a feature, not a review fix.
- **Exit criterion:** re-open when S3/MinIO storage is actually wired (validate the interface against real fs call sites at that time) OR if the dead code is deliberately removed.

## Deferred 6 — AGG-C7-R5: perf record-only (all documented-intentional / bounded)

- **Severity/Confidence (original, preserved):** LOW — perf-reviewer (all byte-identical at HEAD, NO source change this cycle).
- **Where / items:** SW metadata lost-update (`public/sw.template.js` / `lib/sw-cache.ts`, RC-1, best-effort cache by design); bootstrap `notInArray` over ≤1000 failed IDs (`image-queue.ts:609-611`, RC-2, happy-path zero-cost); decode-per-format ~18/image (`process-image.ts:1109-1115`, RC-3, WI-14 correctness tradeoff); Atom feed filesort (`data.ts:771-794`, RC-4, bounded by FEED_LIMIT+cache); timeline non-sargable YEAR()/MONTH() (`data-timeline.ts:184-205`, RC-5, bounded by LIMIT); single-pool/10 + single-writer topology (RC-6); `getMapImages()` unbounded (`data.ts:1565-1592`, RC-7 = PERF-R4C15-B); analytics 'all'-window temp-table aggregation (`analytics-data.ts:93-111,188-191`, RC-8 = PERF-R5C2-01). NEW observation **PERF-C7-OBS-1** (LOW, no fix): semantic-search scores ≤`SEMANTIC_SCAN_LIMIT=5000` 512-dim vectors synchronously on the event loop (`app/api/search/semantic/route.ts:247-274`; cap `lib/clip-embeddings.ts:14`).
- **Reason for deferral:** UNCHANGED — all DOCUMENTED-INTENTIONAL or bounded, none regressed, none a live defect. PERF-C7-OBS-1 is bounded by a hard 5000-row cap + default-`disabled` admin opt-in + 30/min/IP rate limit + deliberate stub-demo design (single-digit-to-low-tens-ms worst case).
- **Exit criterion:** re-open per-item only if the bounding assumption breaks (SW cache needs a hard 50 MB CAS guarantee; failed-ID set exceeds 1000; feed/timeline outgrows its LIMIT bound; the deployment is horizontally scaled; for PERF-C7-OBS-1 — a real `production` CLIP encoder ships AND the embeddings table holds the full 5000-row cap, at which point move scoring off the event loop or chunk it with yields).

## Deferred 7 — AGG-C7-R6: designer UI-polish trio (DES-C5-2/3/4)

- **Severity/Confidence (original, preserved):** LOW — designer (re-confirmed OPEN, NOT re-escalated).
- **Where:**
  - **DES-C5-2:** `apps/web/src/components/nav-client.tsx:85,93,122,155,166` — theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible:ring` (UA-default outline still applies, so NOT a hard WCAG 2.4.7 failure — visually inconsistent vs ~29 ring sites).
  - **DES-C5-3:** `apps/web/src/components/lightbox-color-pip.tsx:237` `text-white/50` gamut suffix = 5.15:1 (passes 4.5:1, thinnest margin); `apps/web/src/components/histogram.tsx:691` `decoration-muted-foreground/40` dotted-underline ~2:1 affordance cue.
  - **DES-C5-4:** `apps/web/src/components/photo-viewer.tsx:816` topic Badge renders the raw topic slug (`{image.topic}`) rather than a humanized label (sibling Back button + search both humanize).
- **Reason for deferral:** UNCHANGED from plan-336/340/342. Cosmetic/consistency polish; none is a hard WCAG failure or a functional defect. Best fixed together in a dedicated UI-polish pass to avoid scattered one-line churn.
- **Exit criterion:** re-open when a UI-polish pass is scheduled, OR if any becomes a hard failure (e.g. a focus-ring removal elsewhere makes the nav inconsistency a 2.4.7 violation, or the color-pip margin drops below 4.5:1).

## Deferred 8 — AGG-C7-R7: SW lost-update + real-encode test isolation + gain-map dead-code note

- **Severity/Confidence (original, preserved):** LOW — debugger/perf-reviewer/test-engineer (all re-confirmed OPEN).
- **Where / items:**
  - **SW image-cache metadata lost-update:** `public/sw.template.js` — whole-doc overwrite, no CAS (best-effort cache by design; same as RC-1).
  - **Real-encode test isolation (AGG-C4-T2):** the real-AVIF/WebP tests + the documented `backfill-color-pipeline` / `process-image-color-roundtrip` libheif cold-flake write derivatives into the shared `public/uploads/{avif,webp,jpeg}` and rely on `afterAll` unlink; no per-test `mkdtemp` isolation of the OUTPUT dir (`process-image-color-roundtrip.test.ts:31-44`). NOT regressed, did NOT reproduce this cycle.
  - **Gain-map dead-code note (DBG-C6-NC-01 record-only):** `apps/web/src/lib/gain-map-detection.ts:87` — `readNullTerminatedAscii` has an unreachable `if (p > limit) return ''` guard (the `while (p < limit)` loop guarantees `p <= limit` on exit). Harmless dead branch, no impact.
- **Reason for deferral:** UNCHANGED. SW lost-update is best-effort by design (no data-loss — it's a cache); the test-isolation cold-flake has not reproduced across recent cycles (did not reproduce this cycle); the gain-map guard is harmless dead code. None is a correctness/security/data-loss finding.
- **Exit criterion:** SW — re-open if a hard 50 MB cap or exact-metadata guarantee is required. Test isolation — re-open if the cold-flake reproduces in CI (isolate the OUTPUT dir per test via `mkdtemp` + a configurable upload-dir override). Gain-map dead code — remove opportunistically if `gain-map-detection.ts` is next edited (zero-risk one-line deletion); not worth a standalone commit.

## Deferred 9 — AGG-C7-R8: dependency hygiene (dev/build-only CVEs)

- **Severity/Confidence (original, preserved):** High (CVE) / runtime-risk NONE — security-reviewer.
- **Where / items:**
  - **SEC-C7-01:** esbuild RCE CVE (GHSA-gv7w-rqvm-qjhr) reachable only via `tsx`+`drizzle-kit` **devDependencies** (`node_modules/{tsx,drizzle-kit}/node_modules/esbuild`). Deno-specific + needs a hostile `NPM_CONFIG_REGISTRY`; the production deps tree is clean.
  - **SEC-C7-02:** postcss XSS-in-stringify (GHSA-qx2v-qp2m-jg93) is **build-time** over the app's own first-party CSS (`node_modules/next/node_modules/postcss`); no untrusted-input path.
- **Reason for deferral:** Per CLAUDE.md "Color & HDR Pipeline" / npm-audit guidance ("`npm audit` unchanged — downgrade-only fixes — do NOT take"), the fixes are downgrade-only and would downgrade Next; CLAUDE.md's "Always Use Latest Versions" rule (global) forbids pinning to outdated majors. Neither CVE is runtime-exploitable (dev/build-only, no untrusted input). NOT a runtime security finding.
- **Exit criterion:** re-open when an upstream non-downgrade fix is available (a `tsx`/`drizzle-kit`/`next` release that bumps the transitive esbuild/postcss to a patched version without regressing the app's required majors), OR if either transitive dep becomes reachable from a runtime-exploitable path.

## Deferred 10 — DOC-C7-01: AGENTS.md `.context/plans/` gitignore imprecision

- **Severity/Confidence (original, preserved):** LOW — document-specialist.
- **Where:** `AGENTS.md:40` says `.context/plans/` "is gitignored" but `git ls-files .context/plans` returns tracked historical artifacts (README.md, done/*.md); the forward `.gitignore:19-21` rule IS accurate, and live plans actually live in repo-root `/plan/`.
- **Reason for deferral:** UNCHANGED. Pre-known historical-artifact nuance, not a code contradiction; the forward ignore rule is correct. NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open opportunistically when AGENTS.md is next edited — reword to "newly-created `.context/plans/` content is gitignored; some historical artifacts remain tracked; live plans live in `/plan/`."

---

## Cosmetic record-only (no plan entry needed; documented for provenance)

- **AGG-C7-05 (VP8L substring scan)** is SCHEDULED in plan-343 Item 5 (may be deferred there if cycle budget is tight — it is pre-existing, privacy-safe, and on a rare fallback path; if deferred, its exit criterion is: re-open when `process-image.ts` WebP fallback is next touched, replace the whole-buffer scan with an offset-12 FourCC check).

## Progress log

- 2026-06-13 — Plan created from `_aggregate.md` cycle-7 (run-9 cycle-4). HEAD `d0920957`. 10 deferred entries (all carried forward UNCHANGED or with updated recurrence-trend notes). No correctness/security/data-loss finding deferred (the two MED findings — admin-header a11y + WebP XMP test gap — are scheduled in plan-343 Items 1-2; the WebP XMP gap is a test-coverage finding on a proven-correct branch, not a live bug).
