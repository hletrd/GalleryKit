# Plan 340 — Run-9 Cycle-2 deferred / record-only findings (cycle 5/100)

**Source:** `.context/reviews/_aggregate.md` (run-9 cycle-2 fan-out, 11 agents, no failures). HEAD at planning time: `1dde9b1e`.
**Rule basis (STRICT, per the cycle's deferred-fix policy):** Every review finding is either scheduled in `plan-339-run9-cycle2-fixes.md` or recorded HERE. No finding is silently dropped. Each entry below preserves the ORIGINAL severity/confidence (never downgraded to justify deferral), a file+line citation, a concrete deferral reason, and an exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY when CLAUDE.md explicitly permits, with the rule quoted. Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, Node 24+/TS6).

> This list is ONLY for existing review findings. No new refactors/features are introduced under "deferred."

---

## Deferred 1 — AGG-C5-03 part 2: durable touch-target audit rule for bare inline `<Link>`/`<a>`

- **Severity/Confidence (original, preserved):** MED / High (the live a11y defect — the three specific links — is SCHEDULED as plan-339 Item 3; ONLY the durable audit-hardening is deferred here).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:424-466` — the `<Link>`/`<a>` FORBIDDEN patterns fire only on an EXPLICIT sub-44 sizing token; a bare inline link with no height token is out of scope by design (committed comment `:430-432`: "plain text links never trip").
- **Reason for deferral:** the hard part is intentionally harder than the Button scan, and the prior cycle punted on it for a sound reason: a "bare link has no height token ⇒ flag it" rule would FALSE-POSITIVE every link that legitimately inherits >=44 px from a sized flex/grid parent (search result rows, nav topic chips before they got `min-h-[44px]`, etc.). A correct heuristic (flag interactive `<Link>`/`<a>` whose className has NO sizing token AND is NOT inside a `flex`/`grid` parent with a height) is high engineering cost (the scanner is regex/source-text based and has no DOM/layout model). The three CONCRETE live links are fixed in plan-339 Item 3; this entry is only about closing the audit's structural blind spot durably. NOT a correctness/security/data-loss finding (it's test-gate coverage, and the underlying a11y defect is being fixed).
- **Exit criterion:** re-open when a dedicated audit-hardening / UI-polish pass is scheduled. The pragmatic middle path (cheaper than a full layout-aware heuristic): add the three fixed links to a small POSITIVE assertion (assert each still carries `min-h-11`) so a future drop of their tap-area is caught — this is a near-zero-cost partial close that the implementer MAY take opportunistically in plan-339 Item 3's commit. The full bare-link heuristic remains deferred until the audit gains structural/parent-context awareness or the cost is explicitly accepted.
- **UPDATE (cycle 5, this run):** the pragmatic middle path WAS taken — plan-339 Item 3's commit added a positive-assertion `it` block to `touch-target-audit.test.ts` pinning that the three recovery `<Link>`s keep `min-h-11` (proven RED-on-revert). So the three SPECIFIC links are now regression-guarded. ONLY the full layout-aware bare-link heuristic (flag ANY bare interactive `<Link>`/`<a>` not inheriting >=44 px from a sized parent) remains deferred under the original rationale (false-positive risk + the scanner having no DOM/layout model).

## Deferred 2 — AGG-C5-R1: color-pipeline writer consolidation (WI-09 `applyColorPipelineResult()`)

- **Severity/Confidence (original, preserved):** MED / (maintainability) — architect.
- **Where:** `apps/web/src/lib/image-queue.ts` (upload, splits the concern — color cols at INSERT in `apps/web/src/app/actions/images.ts:340-360`, derivative flags at the queue UPDATE `:368-371`) ↔ `apps/web/src/lib/admin-backfill-runner.ts` (in-app, Writer B) ↔ `apps/web/scripts/backfill-color-pipeline.ts` (sidecar, Writer C). The true duplication is B↔C (~120 LOC, 4 comment-coupled concerns).
- **Reason for deferral:** the duplication is now CONVERGING, not drifting — all three cycle-4 divergences (AGG-C4-02/04/05) are CLOSED and the two backfill paths are byte-equivalent on the 10-column UPDATE set, the `[]`-dir-scan cleanup contract, AND the detection-failure semantics. So consolidation is a maintainability INVESTMENT, not a correctness fix. Extracting a shared `applyColorPipelineResult()` writer is a non-trivial refactor that must keep authoring and review as separate passes (CLAUDE-omc policy) and re-anchor the cross-site tests; doing it as a rushed same-cycle change risks re-introducing a divergence the tests don't yet cover. This is the SAME root cause as the prior-deferred triplicated-ICC-ladder (AGG-R8c3-13). NOT a correctness/security/data-loss finding (the paths are currently correct and test-locked).
- **Exit criterion:** re-open as a dedicated WI-09 refactor when color-pipeline work is next scheduled: extract `applyColorPipelineResult(tx, id, signals, decision)` owning the 10-column write + the `affectedRows===0 → cleanupDeletedMidReencode(…, [])` contract + the detection-failure (derivative-only, no version bump) branch, have all three call sites use it, and anchor ONE cross-site test asserting the shared contract. Until then the comment-coupled duplication is correct and locked by `backfill-color-pipeline.test.ts` + `admin-backfill-runner-*.test.ts`.

## Deferred 3 — AGG-C5-R2: `lib/api-auth.ts` → `@/app/actions/auth` layering inversion

- **Severity/Confidence (original, preserved):** LOW / (arch) — architect (re-affirmed; authoritative scan still finds exactly ONE inversion, no cycle).
- **Where:** `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — the SOLE `lib`→`app` import in the codebase.
- **Reason for deferral:** single, well-contained inversion that creates no import cycle and no runtime hazard; it is the documented central auth wrapper. Refactoring (moving `isAdmin` into `lib/` or inverting the dependency) is a structural change with no behavioral payoff this cycle. NOT a correctness/security/data-loss finding. Carried forward from plan-336/338 unchanged.
- **Exit criterion:** re-open if a SECOND `lib`→`app` inversion appears (signaling drift toward a tangled boundary) or if `isAdmin` is relocated for another reason — at which point move the auth predicate into `lib/` so `api-auth.ts` no longer reaches into `app/`.

## Deferred 4 — AGG-C5-R3: `COLOR_IMPACTING_KEYS` hand-maintained + partial `server-only` markers

- **Severity/Confidence (original, preserved):** LOW / (arch hardening) — architect (re-affirmed).
- **Where:** `apps/web/src/lib/settings-hash.ts:37-49` (`COLOR_IMPACTING_KEYS` is a hand-maintained array, not derived from `GalleryConfig`); 14 `@/db`-importing libs are server-only by docstring but only `apps/web/src/lib/caption-generator.ts:19` carries `import 'server-only'`.
- **Reason for deferral:** the boundary TEST still enforces the server-only set and is non-vacuous (architect verified), and no new lib started importing `@/db` this cycle — so the hardening (deriving the keys from the config type, adding `import 'server-only'` to the other 13) is belt-and-braces, not a live defect. NOT a correctness/security/data-loss finding. Carried forward unchanged.
- **Exit criterion:** re-open when `settings-hash.ts` or the server-only boundary is next touched — derive `COLOR_IMPACTING_KEYS` from the `GalleryConfig` color-field subset (so a new color setting can't be forgotten in the ETag hash), and add `import 'server-only'` to the remaining `@/db`-importing libs for defense in depth.

## Deferred 5 — AGG-C5-R4: `@/lib/storage` dead seam (interface-rot risk)

- **Severity/Confidence (original, preserved):** LOW — architect (record-only).
- **Where:** `apps/web/src/lib/storage/` (~390 LOC) — consumed only by its own index + a test; honestly self-documented as unwired (the upload/processing/serving pipeline is local-filesystem-only) per CLAUDE.md ("Storage Backend (Not Yet Integrated)").
- **Reason for deferral:** it is dead but DELIBERATE and documented — not a defect. The only risk is interface-rot if storage backends are wired later without re-validating against the real `fs` call sites. CLAUDE.md explicitly says: "Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end." So removal is wrong (it's a planned seam) and wiring is out of scope. RECORD-only.
- **Exit criterion:** re-open ONLY when storage-backend integration is actually scheduled — at that point validate the abstraction against every real filesystem call site before exposing any backend switch. No action while it remains a documented future seam.

## Deferred 6 — AGG-C5-R5: documented-intentional performance tradeoffs

- **Severity/Confidence (original, preserved):** LOW — perf-reviewer (all byte-identical at HEAD; record-only).
- **Where / items:** SW metadata lost-update (`public/sw.js`, best-effort cache — see Deferred 7); bootstrap `notInArray` over ≤1000 permanently-failed IDs (`apps/web/src/lib/image-queue.ts:601-603`, happy-path zero-cost); decode-once-per-format ~18 decodes/image (WI-14 fresh-instance-per-format for color correctness); Atom feed filesort (bounded by FEED_LIMIT + cache); timeline non-sargable `YEAR()/MONTH()` (bounded by LIMIT); single-pool/10 + single-writer topology.
- **Reason for deferral:** every one is a DOCUMENTED, deliberate tradeoff (color correctness, restart-safety, or the single-writer topology CLAUDE.md mandates), with a happy-path cost of zero or a bound that caps the worst case. None is a live defect. NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open a specific item only if profiling on production data shows it as a measured hot path (e.g. the bootstrap `notInArray` if the permanently-failed set ever approaches its 1000 cap, or the timeline query if a year accumulates enough rows that the LIMIT no longer bounds the filesort cost). No action absent such evidence.

## Deferred 7 — AGG-C5-R7 / AGG-C4-08: service-worker image-cache metadata lost-update (no CAS)

- **Severity/Confidence (original, preserved):** LOW / High — debugger BUG-1 + perf-reviewer PERF-L1 (re-confirmed unchanged; SAME as prior AGG-R8c3-10 / AGG-C4-08).
- **Where:** `apps/web/public/sw.template.js` (shipped source) + `apps/web/public/sw.js` (generated) — `touchMeta` / `recordAndEvict` do `getMeta → mutate → setMeta` (whole-doc overwrite) with no single-flight lock (~`:70-122,152-161` in `sw.js`).
- **Reason for deferral:** cache-HOUSEKEEPING only (the 50 MB LRU `total` accounting + recency timestamps), never served bytes. N concurrent masonry tiles can drop each other's meta writes, so the LRU `total` can drift low (cache exceeds the 50 MB soft cap until the browser's own quota eviction reclaims it). CLAUDE.md documents the SW cache as best-effort ("stale-while-revalidate", "OFFLINE-ONLY fallback", "50 MB LRU cap"); no correctness or data-loss guarantee is breached. **CLAUDE.md rule that permits this:** the Service Worker section describes the image-derivative cache as "stale-while-revalidate … 50 MB LRU cap" and the HTML fallback as a deliberate best-effort offline-only cache — the cap is a SOFT target, not a hard invariant. NOT a security/correctness/data-loss finding.
- **Exit criterion:** re-open if a HARD 50 MB cap becomes a requirement (e.g. low-storage-device complaints), at which point add a single-flight meta-write lock or an atomic CAS around `setMeta`, re-stamp `sw.js` via `scripts/build-sw.ts`, and update `apps/web/src/__tests__/sw-template-contract.test.ts`. No action while the cap remains a soft target.

## Deferred 8 — AGG-C5-R6 / DES-C5-2: nav controls have no `focus-visible:ring`

- **Severity/Confidence (original, preserved):** LOW / High — designer (re-confirmed open; prior DES-5 / plan-336 Deferred-6, NOT re-escalated).
- **Where:** `apps/web/src/components/nav-client.tsx:85` (title `<Link>`), `:93` (mobile-expand `<button>`), `:122` (topic `<Link>`s), `:155` (theme `<button>`), `:168` (locale `<button>`).
- **Reason for deferral:** these carry `min-h-[44px]`/`min-w-[44px]` + hover affordances but NO `focus-visible:ring-*`. Crucially they do NOT set `outline-none`, so the UA-default focus outline still applies — so this is NOT a hard WCAG 2.4.7 failure, only visual inconsistency vs the ~29 `focus-visible:ring` sites elsewhere and the thin default outline being easy to miss against the translucent nav. NOT a correctness/security/data-loss finding. Carried forward from plan-336/338 unchanged.
- **Exit criterion:** re-open when a UI-polish pass runs — add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the three `<button>`s and two `<Link>`s to match the rest of the app. No action while the UA outline provides a baseline focus indicator.

## Deferred 9 — AGG-C5-R6 / DES-C5-3: color-pip gamut-suffix margin + faint histogram underline

- **Severity/Confidence (original, preserved):** LOW / Medium — designer (re-confirmed open; prior DES-6 / plan-336 Deferred-6).
- **Where:** `apps/web/src/components/lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` (white@50% over white@10%-on-near-black = **5.15:1**, `text-[10px]`); plus the histogram dotted-underline affordance being faint.
- **Reason for deferral:** the gamut-suffix contrast (5.15:1) PASSES the 4.5:1 small-text floor — it is merely the THINNEST color-UI margin, not a failure; the faint underline is a perceptibility nit. Neither is a WCAG failure. NOT a correctness/security/data-loss finding. Carried forward unchanged.
- **Exit criterion:** re-open when a UI-polish pass runs — bump the gamut suffix to `text-white/70` (would raise the margin comfortably above 5:1) and strengthen the histogram underline affordance. No action while both pass their respective thresholds.

## Deferred 10 — AGG-C4-09 (carried): stale `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6` (real count 1)

- **Severity/Confidence (original, preserved):** LOW / Med — critic + test-engineer (both re-measured at HEAD: real scanner count is **1**; 5 of the 6 `size=` buttons now carry `h-11`, only `batchAddButton:328` trips).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts` — the `KNOWN_VIOLATIONS['components/image-manager.tsx']` entry (was `:182`; verify current line).
- **Reason for deferral:** test-PRECISION, not a live defect. The aggregate budget of 6 (vs real 1) leaves up to ~5 NEW sub-44 targets in that one file able to ship before the gate fires, but the stale-budget detector at `:710-714` is informational, not a hard failure. SAME finding as prior AGG-R8c3-15 / AGG-C4-09 (plan-336 Deferred-5, plan-338 Deferred-2). **This cycle it is listed as OPTIONAL in plan-339 Item 6** (because Item 2 already edits this same test file) — if the implementer opportunistically tightens 6→1 there, this entry CLOSES; if not, it remains deferred on the original rationale. NOT a correctness/security/data-loss finding.
- **Exit criterion:** close by recounting the real value (zero the budget, read the audit output, restore) and tightening the entry to 1 with a measurement-dated comment and the `batchAddButton:328` rationale — ideally in plan-339 Item 2's commit since it already touches this file. Otherwise re-open the next time touch-target-audit work is scheduled.

## Record-only OBSERVATION (NOT a counted finding) — AGENTS.md `.context/plans/` gitignore note imprecision

- **Severity/Confidence:** LOW / Low (document-specialist OBSERVATION, explicitly NOT counted as a net-new mismatch).
- **Where:** `AGENTS.md:40` — "`.context/plans/` is gitignored — local plan-management artifacts only."
- **Note:** this is imprecise as a blanket statement (the repo's actual plan files live in the tracked `plan/` directory, and 59 files under various `.context/` review subdirs are already tracked — committed before the `.context/*` ignore rule took effect), BUT it is a git-mechanics nuance about a historical artifact, not a code-value contradiction, and the rule DOES govern NEW `.context/plans/` files. document-specialist recorded it for completeness only and did NOT count it. No action required; included here so it is not "silently dropped." If AGENTS.md is next edited, the line could be clarified to "new files under `.context/plans/` are gitignored" — but this is cosmetic doc precision, not a scheduled fix.
