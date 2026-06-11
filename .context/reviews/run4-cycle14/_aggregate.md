# Aggregate review — Run-4 Cycle 14

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c13). Each angle was executed as a
distinct full-inventory in-context pass; no angle sampled. Inventory:
independent line-level regression review of the cycle-13 fix commit
(`414a8e18` map_visible carry, verified against the full 5-column topics
schema); rotation to the least-run-4-covered surfaces by a fresh
mention-count coverage map over run4-c1..c13 review texts — the
**color / display-capability client cluster** (`color-details-section`,
`lightbox-color-pip`, `wide-gamut-hint`, `info-bottom-sheet` color
region, `use-display-capability`, `icc-chromaticity`,
`gain-map-detection`, `color-primaries`, histogram canvas region) plus
the **admin password / tags / seo / analytics clients**,
`updatePassword` action, and micro-libs (`image-zoom-math`,
`i18n/request`, `seo-og-url`, `db/seed`); pattern sweep of every
wide-gamut predicate consumer in `src/`.

## Context
C13 closed the topics-recreate column omission. C14's coverage-map
rotation landed on the color-audit client surface — the product's
photographer-intent headline — and found the third instance of the
loop's recurring failure mode: a canonical helper exists
(`isWideGamutPrimary`, created C3-A1 to own the wide-gamut predicate),
and the two surfaces added after it (R10-L19 / R13-L1) re-derived the
predicate ad-hoc and mis-handle the `'unknown'` enum value that every
ICC-less upload persists.

## Cross-angle agreement
- **COR-R4C14-01** — flagged by code/debugger/tracer (full causal trace
  detection → persistence → public select → render), security/critic/
  verifier (CONFIRMED; no security consequence; critic adds the
  delivered-row predicate-triplication scope note + drift-lock-test
  requirement), perf/architect (predicate-ownership erosion;
  fix-shape = helper + absence-assertion fixture), test-engineer (label
  gating has no test lock — exactly why it shipped), document-specialist
  (code contradicts CLAUDE.md's own `isNonTrivialColor` definition; fix
  makes code match doc), designer (raw-token copy, false signal,
  attention misdirection; KO renders half-translated "색상: unknown").
  **6/6 angles.**
- **COR-R4C14-02** — code (dead branch confirmed), security (no
  security consequence, under-detect only), document-specialist (comment
  claims unreachable behavior; make the code match the documented R5-M3
  intent), test-engineer (existing R5-M3 locks stay green; add
  tmap+URN-positive case). 4/6 angles.
- **DES-R4C14-B** — designer (unreachable spinner state), code angle
  concurs as dead UI state. 2/6 angles.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C14-01 | **MED/High (CONFIRMED)** | `ColorDetailsSection` + `InfoBottomSheet` treat `color_primaries === 'unknown'` as wide gamut via ad-hoc `!== 'bt709'` checks (`color-details-section.tsx:169-173,221`; `info-bottom-sheet.tsx:183-186`): the accordion headline renders the raw enum — "Color: unknown" (EN) / "색상: unknown" (KO) — and auto-opens for every ICC-less upload (`inferColorPrimaries(null)='unknown'` persisted at `images.ts:352`, public field). Every sibling consumer uses the canonical `isWideGamutPrimary()` whose docstring mandates single-source-of-truth. Fix: gate the label + isNonTrivialColor primaries-arm through `isWideGamutPrimary` in both files; route the two delivered-row derivations (`color-details-section.tsx:454`, `lightbox-color-pip.tsx:207`) through it too (semantically identical); lock with a source-fixture test asserting helper usage + absence of surviving ad-hoc comparisons. | code, security, perf, test, document, designer (6/6) |
| COR-R4C14-02 | LOW/High (CONFIRMED) | `gain-map-detection.ts` heuristic-1 `tmap`+URN branch (252-255) is dead code — `parseInfe:133` only parses `item_uri` for `'urim'`. Fix: parse the URI for `tmap` items too, making the R5-M3 comment true; add a tmap+URN-positive fixture case; existing locks stay green. | code, security, document, test (4/6) |
| RISK-R4C14-03 | MED impact / **Low** conf (NEEDS VALIDATION) | iOS 17+ ISO 21496-1 HEICs whose `tmap` is referenced only via `dimg` (auxl pointing gainmap→primary, both hvc1) would evade both heuristics → `has_gain_map` under-reports (admin-only audit row, fail-quiet). Cannot confirm without a real-device fixture; speculative widening risks false positives (critic). DEFER with fixture-acquisition exit criterion. | code, security, test |
| TEST-R4C14-01 | gap/High | No fixture locks the R13-L1 accordion-label gating / isNonTrivialColor predicate — folds into COR-R4C14-01 (source-inspection fixture per repo convention) | test |
| DES-R4C14-B | LOW/High | `tag-manager.tsx:139-142` delete dialog closes synchronously while the async delete is in flight — `isDeleting` spinner/disabled states unreachable; silent multi-second gap until the toast. Fix: `preventDefault` the auto-close, await the action, close on completion. | designer, code (2/6) |
| OBS-R4C14-A / DOC-R4C14-03 | INFO/High | `touch-target-audit.test.ts` prose still narrates pre-lift Button defaults (32/36 px) while `ui/button.tsx` ships 44 px floors for all variants; exempted icon buttons are real-44px. Self-consistent + conservative — record in deferred ledger, refresh on next audit edit. | test, document |
| DOC-R4C14-01 | INFO/High | CLAUDE.md's `isNonTrivialColor` definition ("wide-gamut OR HDR OR non-srgb decision") is the authoritative contract; the COR-R4C14-01 fix makes code match doc — no doc edit needed; cite in commit body. | document |

## Regression review of cycle-13 commit — SOUND
`414a8e18` verified at line level against the current 5-column topics
schema: in-transaction SELECT widened, all non-form columns carried,
TOCTOU closed, VALUES pinned by test. No follow-on work.

## Clean-pass surfaces this cycle
`use-display-capability.ts` (React #185 invariant held; subscription
hygiene), `icc-chromaticity.ts` (full bounds audit clean; chad inversion
guarded), `wide-gamut-hint.tsx` (storage shape-validation + dismissal
granularity sound), `lightbox-color-pip.tsx` ('unknown' handled via the
correct localized pattern), `histogram.tsx` canvas region,
`updatePassword` + `password-form.tsx` (hardening re-verified; client
UTF-16 vs server code-point minLength mismatch is safe-direction),
`seo-client.tsx`, `analytics-client.tsx`, `image-zoom-math.ts`,
`i18n/request.ts`, `seo-og-url.ts`, `db/seed.ts`.

## Standing deferrals re-audit (exit criteria un-triggered this cycle)
Diff since the c13 review commit (`4042a7a9..HEAD`) touches only
`plan/plan-297` progress notes — none of the deferral surfaces:
- DEF-R4C11-A (aria-live constant string, plan-294) — untouched. Deferred.
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day,
  plan-292) — untouched. Deferred.
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English) — no LR change. Deferred.
- OPS-R4C6-01 (host nginx `/uploads/`, MED/High preserved, plan-284) —
  no host nginx maintenance. Deferred.
- DEF-R4C8-A/B/C/D (paid GET bodies, interstitial 410, ImageZoom
  passive preventDefault, Tailwind safelist, plan-288) — untouched.
  Deferred.
- Histogram mode-cycle aria-label (since plan-286) — deferred.
- OBS-R4C12-B/C/D/E (plan-296) — quota-lock invariant intact,
  claim-retry guards intact, data.ts:83 untouched, ETag format
  unchanged. All remain recorded.
- DOC-R4C13-01/02 (plan-298) — no CLAUDE.md edit to the relevant
  sections this cycle. Remain recorded.

## Gate baseline (clean tree)
vitest 183 files / 1748 tests green pre-change (run this cycle); all 8
gates run during PROMPT 3 after the fixes land.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. All
scheduled fixes tighten existing surfaces' honesty, consistency, or
feedback.

## AGENT FAILURES
None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide constraint).
