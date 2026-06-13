# Plan 336 — Run-8 Cycle-3 deferred / record-only findings

**Source:** `.context/reviews/_aggregate.md` (run-8 cycle-3 fan-out). HEAD at planning time: `ada92ba5`.
**Rule basis (STRICT, per the cycle's deferred-fix policy):** Every review finding is either scheduled in `plan-335-run8-cycle3-fixes.md` or recorded HERE. No finding is silently dropped. Each entry below preserves the ORIGINAL severity/confidence (never downgraded to justify deferral), a file+line citation, a concrete deferral reason, and an exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY when CLAUDE.md explicitly permits, with the rule quoted. Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, Node 24+/TS6).

> This list is ONLY for existing review findings. No new refactors/features are introduced under "deferred."

---

## Deferred 1 — AGG-R8c3-09: encode-heavy tests flake under full-suite parallelism

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/src/__tests__/backfill-color-pipeline.test.ts` + `apps/web/src/__tests__/process-image-color-roundtrip.test.ts`. Both encode real AVIF via libheif and share the real `apps/web/public/uploads` tree with ~13 sibling tests.
- **Reason for deferral:** test-INFRA noise, not a logic defect. Under full-suite parallelism the libheif encoder contends on the shared `public/uploads` files → intermittent "corrupt header" / `outcome: error`. Both pass in isolation (6/6, 11/11), together (17/17), and on warm rerun (full suite 2060/2060). Neither file was touched this cycle, and no production code path is affected. This is NOT a correctness/security/data-loss finding, so it is freely deferrable. It DOES produce a RED-on-cold-CI signal (same class as the AGG-R8-01 boundary flake the prior cycle de-flaked), so it should be addressed when test-infra work is next scheduled.
- **Exit criterion:** re-open when (a) the encode tests are migrated to a unique per-test temp upload dir (or a serial pool / `describe.sequential`) so they no longer contend on shared `public/uploads`, OR (b) the flake escalates to failing on warm reruns / blocking a real CI gate. Until then, the warm-rerun-green status keeps the cycle's gate honest.

## Deferred 2 — AGG-R8c3-10: service-worker image-cache metadata lost-update (no CAS)

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/public/sw.template.js` — `touchMeta` / `recordAndEvict` do `getMeta → mutate → setMeta` (whole-doc overwrite) with no single-flight lock.
- **Reason for deferral:** the affected state is cache-HOUSEKEEPING only (the 50 MB LRU `total` accounting + recency timestamps), never served bytes. N concurrent masonry tiles can drop each other's meta writes, so the LRU `total` can drift low (cache exceeds the 50 MB soft cap until the browser's own quota eviction reclaims it) or recency is lost. CLAUDE.md documents the SW cache as best-effort (the HTML offline fallback and image SWR are explicitly "best-effort"/"offline-only fallback"); no correctness or data-loss guarantee is breached. Pre-existing (not introduced this cycle).
- **Exit criterion:** re-open if a hard 50 MB cap becomes a requirement (e.g. low-storage-device complaints), at which point add a single-flight meta-write lock or an atomic compare-and-swap around `setMeta`. No action while the cap remains a soft target.

## Deferred 3 — AGG-R8c3-12: `lib/api-auth.ts` → `app/actions/auth` layering inversion

- **Severity/Confidence (original, preserved):** LOW / Med.
- **Where:** `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — a `lib`→`app` upward dependency.
- **Reason for deferral:** maintainability/architecture, not a live defect. There is NO hard ESM cycle today and the gates are green; the inversion is a near-cycle that COULD be copied into future `lib` code. Fixing it (extracting identity reads to a `lib/auth-session.ts` leaf) is a non-trivial refactor touching the auth surface — out of proportion to a one-cycle hygiene pass, and risky to land alongside the substantive MED fixes without dedicated review. No security finding (the auth check itself is correct; only the import direction is upside-down).
- **Exit criterion:** re-open when (a) a second `lib` module needs `isAdmin`/identity (the inversion would then be replicated), OR (b) an actual ESM circular-import warning appears, OR (c) a dedicated auth-layer refactor cycle is scheduled. Then extract `lib/auth-session.ts` and have both `app/actions/auth` and `lib/api-auth` import down from it.

## Deferred 4 — AGG-R8c3-13: ICC-name→gamut token ladder triplicated

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** the same `displayp3/dcip3/adobe/prophoto/bt2020/srgb…` token ladder is hand-rolled in `apps/web/src/lib/color-detection.ts` (`inferColorPrimaries`), `apps/web/src/lib/process-image.ts` (`resolveColorPipelineDecision`), and `process-image.ts` (`resolveAvifIccProfile`).
- **Reason for deferral:** DRY/maintainability, not a live defect. The three ladders agree TODAY (verified — admin audit matches delivery for all shipped gamuts). The risk is latent: a NEW gamut keyword (WI-09 / Rec.2100) added to only one ladder would make the admin audit silently disagree with delivery, uncaught by the current per-function tests. No current photographer-visible incorrectness. (NOTE: the NCLX-first-audit vs ICC-name-first-DELIVERY *precedence inversion* between these modules is INTENTIONAL and documented in CLAUDE.md — that is NOT a defect and is explicitly excluded from this finding; only the duplicated token-matching ladder is.) Extracting a shared `iccNameToGamut(name)` helper is best done WITH the WI-09 HDR-encoder work that will add the next keyword, so the consolidation and the new keyword land together with one test.
- **Exit criterion:** re-open when WI-09 (or any new gamut/transfer keyword) is implemented — at that point extract a single client-safe `iccNameToGamut` helper and add a cross-module consistency test, so the new keyword cannot be added to one ladder and forgotten in the others.

## Deferred 5 — AGG-R8c3-15: stale `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6`

- **Severity/Confidence (original, preserved):** LOW / Med.
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:182`.
- **Reason for deferral:** test-precision, not a live a11y defect. Post-AGG-R8-03 the real scanner-visible count in `image-manager.tsx` is lower than the declared 6 (most `size="sm"`/`size="icon"` hits now carry explicit `h-11` overrides, and the file's runtime is 44px-compliant via `ui/button.tsx`'s `min-h-11` floor). An over-stated exemption count means the aggregate audit could mask up to ~5 NEW violations IN THAT ONE FILE before failing — a regression-detection gap, but the dedicated checkbox unit test still guards AGG-R8-03 independently, and the file is admin-only. Pre-existing. Deliberately NOT bundled into Item 4 (which extends the audit pattern) to avoid conflating an exemption-count recount with the scale-token-pattern addition in one commit; recount is cleaner as its own follow-up after Item 4 settles the new pattern's hit set.
- **Exit criterion:** re-open immediately after plan-335 Item 4 lands (the scale-token pattern may change the scanner-visible count for this file) — recount the true value and tighten `KNOWN_VIOLATIONS['components/image-manager.tsx']` to it with a one-line justification. Lower-bound it so a genuine new violation still trips.

## Deferred 6 — AGG-R8c3-17: design polish (DES-5/6/7)

- **Severity/Confidence (original, preserved):** LOW / Med.
- **Where:** (a) nav theme/locale toggle buttons lack the app's `focus-visible:ring` (rely on UA-default outline) — `apps/web/src/components/` nav/header components. (b) lightbox color-pip `text-white/50` suffix is the thinnest passing contrast margin (5.15:1) + faint dotted-underline tooltip cue — `apps/web/src/components/lightbox-color-pip.tsx`. (c) info-sidebar topic `<Badge>` prints the raw slug instead of the humanized label.
- **Reason for deferral:** UX/a11y polish, not a WCAG FAILURE — (a) UA-default focus outline is present (keyboard nav works, just not the app's branded ring); (b) 5.15:1 already PASSES 4.5:1 (it's a thin margin, not a fail); (c) is a cosmetic label-humanization nicety, not an a11y blocker. These are below the threshold of the substantive MED a11y fixes (text-destructive 1.99:1, amber 3.x:1, 24px target) being implemented this cycle, and bundling cosmetic polish risks scope-creep on a convergence-leaning cycle. No accessibility criterion is violated.
- **Exit criterion:** re-open when a dedicated UI-polish pass is scheduled, OR if (b)'s margin regresses below 4.5:1 after any token change, OR if (a) is reported as a keyboard-affordance complaint. Apply the app's `focus-visible:ring-2 ring-ring` to the nav toggles, bump the color-pip suffix to `text-white/70`, and humanize the info-sidebar topic Badge label then.

## Deferred 7 — AGG-R8c3-A1: SW per-tile HEAD probe micro-opt (per-URL probe TTL)

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/public/sw.template.js` `staleWhileRevalidateImage` — fires a 300ms-bounded HEAD per cached tile (~30 concurrent on a warm masonry paint).
- **Reason for deferral:** this is the DELIBERATE R10-H3 color-freshness behavior, already BOUNDED by AGG-R8-05 (300ms abort → serve stale). It is NOT a defect or regression. A per-URL probe TTL in `META_CACHE` would cut the per-tile RTT on rapid re-navigation, but it adds cache-coherency complexity against a behavior that already meets its latency budget. Record-only.
- **Exit criterion:** re-open only if warm-paint INP/LCP telemetry on the offline-resilient surface shows the bounded HEAD is still a measurable bottleneck after AGG-R8-05; then add a short (~5-10s) per-URL probe TTL.

## Deferred 8 — AGG-R8c3-A2: `image-queue.ts` bootstrap `notInArray` micro-cost

- **Severity/Confidence (original, preserved):** LOW / Med.
- **Where:** `apps/web/src/lib/image-queue.ts:601-627` — bootstrap requeue uses `notInArray` over ≤1000 permanently-failed IDs.
- **Reason for deferral:** micro-perf; the happy path (empty permanently-failed set) is zero-cost, and the set is capped at 1000. A `processing_error IS NULL` predicate would be marginally cleaner and restart-safe (the in-memory set is lost on restart anyway), but the current behavior is correct and bounded. Not worth a dedicated commit this cycle.
- **Exit criterion:** re-open if the permanently-failed set is ever uncapped, OR during a future image-queue refactor; switch to `processing_error IS NULL`.

## Deferred 9 — AGG-R8c3-A3: decode-once-per-format + Atom feed `updated_at` filesort

- **Severity/Confidence (original, preserved):** LOW / Med (perf).
- **Where:** `apps/web/src/lib/process-image.ts:1052-1097` (fresh `sharp()` per format×size, ~18 decodes/image) + `apps/web/src/lib/data.ts:771-794` (`getImagesForFeed` orders by `updated_at DESC` with no covering index).
- **Reason for deferral:** re-confirmed from prior cycles as deliberate/bounded. The decode-once cost is CPU-only on the background queue (concurrency-1 default), partially mitigated by `lastRendered` hard-link dedup, and architect-confirmed SAFE (not unsafe). The feed filesort is bounded by `FEED_LIMIT=50` + route `Cache-Control: max-age=600, s-maxage=1800`, with no shipped CDN. Neither is photographer-visible-incorrect; both are accepted scope/throughput tradeoffs documented across prior aggregates (the decode-once item traces to AGG-R8-A2; the feed index to AGG-R8-A1).
- **Exit criterion:** decode-once — re-open if upload throughput becomes a product requirement (then add a single-decode pipeline). Feed index — re-open if a CDN is added or feed traffic rises materially (then add `(processed, updated_at, created_at, id)` index OR document the accepted cost).

## Deferred 10 — AGG-R8c3-A5: COLOR_IMPACTING_KEYS hand-maintained + server-only by comment

- **Severity/Confidence (original, preserved):** LOW / Med-High (ARCH-4 + ARCH-5).
- **Where:** (a) `apps/web/src/lib/settings-hash.ts:37-46` — `COLOR_IMPACTING_KEYS` is a hand-maintained array, not derived from `GalleryConfig` (drifted 3→9 once). (b) the heavy `@/db`-importing libs (`data.ts`, `gallery-config.ts`, `image-queue.ts`, `process-image.ts`, …) declare SERVER-ONLY only in docstrings; only `caption-generator.ts` uses an actual `import 'server-only'` guard.
- **Reason for deferral:** hardening levers, no live defect. (a) The key list is CORRECT today (9 keys, verified by document-specialist + matched to CLAUDE.md `:260`); the risk is a future forgotten entry silently failing cache invalidation when an admin flips a new color setting — a latent maintainability hazard, not a current bug. (b) The `client-server-only-boundary.test.ts` gate already CATCHES a real client→server-only import at test time (the boundary IS enforced, just by a test rather than a per-file `import 'server-only'`), so a missing guard does not currently leak server code to the client. Adding `import 'server-only'` to each heavy lib is a safe but broad change best done deliberately.
- **Exit criterion:** (a) re-open when a NEW color-impacting admin setting is added — at that point either derive `COLOR_IMPACTING_KEYS` from a typed `GalleryConfig` subset or add a test that fails if a color-setting key is missing from the list. (b) re-open if the boundary test is ever weakened/removed, or during a server-only hardening pass; then add `import 'server-only'` to the `@/db`-importing libs.

## Deferred 11 — AGG-R8c3-OWNED-1 / AGG-R8-OWNED-1: Stripe `async_payment_succeeded` never writes an entitlement

- **Severity/Confidence (original, preserved — NOT downgraded):** HIGH / High.
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88,105` handles only `checkout.session.completed` + `payment_status==='paid'`; `apps/web/src/app/api/download/[imageId]/route.ts` returns 404 forever for ACH/bank-transfer settled payments.
- **Reason for deferral (with the repo rule that permits it):** this is a CORRECTNESS finding, normally NON-deferrable. CLAUDE.md EXPLICITLY scopes the support boundary and assigns ownership: *"`checkout.session.async_payment_succeeded` is not yet handled — delayed payment methods (bank transfer / ACH) complete checkout but never receive an entitlement row; only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships."* Per the cycle's deferred-fix rule, security/correctness findings may be deferred when the repo's own rules explicitly allow it — this one does, and assigns it to plan-316. NO DATA LOSS: funds settle in Stripe and the entitlement row is recoverable manually; the webhook correctly mints NO false entitlement for unpaid funds (re-verified by security-reviewer + tracer + document-specialist THIS cycle — it fails CLOSED). Interim operator mitigation: disable async payment methods in Stripe Checkout.
- **Exit criterion (unchanged):** plan-316 CRT-R5C1-04 is picked up, OR a real settled-but-undownloadable ACH/bank-transfer purchase is reported in production → escalate immediately (no longer deferrable once a real customer is affected).

---

## Progress

| Entry | Finding | Severity (preserved) | Disposition | Status |
|---|---|---|---|---|
| Deferred 1 | AGG-R8c3-09 encode-test parallelism flake | LOW | test-infra noise; warm-green | RECORDED |
| Deferred 2 | AGG-R8c3-10 SW meta lost-update | LOW | best-effort cache by design | RECORDED |
| Deferred 3 | AGG-R8c3-12 lib→app layering inversion | LOW | no live cycle; refactor-scope | RECORDED |
| Deferred 4 | AGG-R8c3-13 triplicated ICC token ladder | LOW | DRY; land with WI-09 keyword | RECORDED |
| Deferred 5 | AGG-R8c3-15 stale KNOWN_VIOLATIONS count | LOW | recount after Item 4 | RECORDED |
| Deferred 6 | AGG-R8c3-17 design polish ×3 | LOW | no WCAG fail; polish pass | RECORDED |
| Deferred 7 | AGG-R8c3-A1 SW HEAD per-URL TTL | LOW | already bounded; micro-opt | RECORDED |
| Deferred 8 | AGG-R8c3-A2 image-queue notInArray | LOW | bounded; micro | RECORDED |
| Deferred 9 | AGG-R8c3-A3 decode-once + feed filesort | LOW | accepted throughput tradeoff | RECORDED |
| Deferred 10 | AGG-R8c3-A5 COLOR_IMPACTING_KEYS + server-only | LOW | hardening levers | RECORDED |
| Deferred 11 | AGG-R8c3-OWNED-1 Stripe ACH entitlement | HIGH | already plan-316; repo-rule-permitted | RECORDED |
