# Verifier Review — Run-8 Cycle-3 (evidence-based correctness pass)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD verified against:** `ce0029aa` (working tree CLEAN, in sync with origin/master)
**Mandate:** independently verify — against the actual code at HEAD, not the plan's word — that the 17 run-8 cycle-3 findings (AGG-R8c3-01..17) were addressed, and that the pinning tests are non-vacuous and the gates are actually green.

## Verdict

**Status: PASS.** All 6 gates green (run live by me). All 10 findings the cycle CLAIMED as code-fixed are CONFIRMED-CLOSED with present, correct code AND non-vacuous pinning tests. The other 7 findings were DELIBERATELY DEFERRED to plan-336 (RECORDED, severity preserved) per the repo's deferred-fix rule — none was falsely marked closed. **Zero new correctness issues found. Zero incomplete/regressed fixes.**

---

## 1. Gate baseline (run live by verifier this pass)

| Gate | Command | Exit | Result |
|---|---|---|---|
| ESLint | `npm run lint --workspace=apps/web` | **0** | clean |
| Typecheck | `npm run typecheck --workspace=apps/web` | **0** | `typecheck:app` (next typegen + tsc) + `typecheck:scripts` (7 JS files) both clean |
| API-auth lint | `npm run lint:api-auth` | **0** | OK: 2 admin routes wrap `withAdminAuth` |
| Action-origin lint | `npm run lint:action-origin` | **0** | "All mutating server actions enforce same-origin provenance." |
| Public-route RL lint | `npm run lint:public-route-rate-limit` | **0** | OK: live/og(×2)/semantic/stripe-webhook |
| Vitest (full) | `cd apps/web && npx vitest run` | **0** | **214 files passed (214) / 2067 tests passed (2067) / 0 failed**, 194.78s |
| i18n leaf-key parity | leaf-count diff en.json↔ko.json | n/a | **837 = 837, 0 drift** (`only in en: []`, `only in ko: []` → MATCH) |

**Cold-flake note (AGG-R8c3-09):** the documented cold-flake (`backfill-color-pipeline` + `process-image-color-roundtrip` under full parallelism) **DID NOT reproduce** on my cold run — the full suite passed 2067/2067 on the first try, no isolation rerun needed. Test count grew 2060→2067 (+7), consistent with the new pinning tests added this cycle. No RED observed at any point.

---

## 2. Per-finding verification verdicts

### 2a. Code-fixed this cycle (plan-335, commits 0017a34e..6be638d2) — 10 findings

| Finding | Sev | Commit | Verdict | Evidence (file:line + what I checked) |
|---|---|---|---|---|
| **AGG-R8c3-01** NCLX code-2 isHdr side-effect: pin branch + correct false claim | MED | `22387f32` | **CONFIRMED-CLOSED** | `color-detection.ts:389-401` adds an honest comment at the live `const isHdr = transferFunction === 'pq' \|\| 'hlg'` derivation documenting the intentional reject-at-upload side-effect (the AGG-R8-06 "no delivered-byte impact" claim, which lived only in the immutable commit msg, is corrected here). Test `color-detection.test.ts` (`detectFromNclx(12, 2, 2, {icc:'PQ HDR'})`) is **non-vacuous**: the helper writes a REAL AVIF with an NCLX `colr` box transfer=2 and feeds a PQ-named ICC, then asserts `colorPrimaries==='p3-d65'` (NCLX primaries win) + `transferFunction==='pq'` + `isHdr===true`. Genuinely exercises the code-2 guard path. |
| **AGG-R8c3-02** third `sanitizeForOg` copy + lying docstring | LOW | `0028ede4` | **CONFIRMED-CLOSED** | `(public)/p/[id]/page.tsx:14` now `import { sanitizeForOg } from '@/lib/og-sanitize'` — local copy + lying docstring deleted. All JSON-LD value sites (`:222,223,226`) use it. The shared `og-sanitize.ts:28-29` strips Unicode-format AND C0 (`OG_C0_CONTROL_CHARS` `:25`). C0-parity is **behaviorally** pinned by `og-sanitize.test.ts:34-43` (`sanitizeForOg('a\x00b\x07c\x1F')→'abc'`, tab/LF/CR preserved) and **structurally** by `sanitize-for-og-global.test.ts:66` (JSON-LD page imports the shared helper). |
| **AGG-R8c3-03** backfill orphaned-file leak on delete-race (substantive) | MED | `0017a34e` | **CONFIRMED-CLOSED** | `admin-backfill-runner.ts` reads `affectedRows` on BOTH UPDATE branches — success (`:573`) and detection-failed (`:605`) — and on `=== 0` calls `cleanupDeletedMidReencodeVariants(row)` (`:430-442`) which `deleteImageVariants(DIR, fn, [])` for webp/avif/jpeg. The `sizes=[]` arg genuinely scans the dir (`process-image.ts:505-522` `fs.opendir`, matches `{name}_*{ext}`) → "removes ALL variants" claim is accurate. New `deleted-mid-reencode` reason is its own tally (`:720-726`); `hadFailures` (`:791`) excludes it so the WITH-FAILURES banner is not flipped. Test `admin-backfill-runner-deleted-mid-reencode.test.ts` is **non-vacuous**: forces `affectedRows:0`, asserts `processImageFormatsMock` WAS called (genuinely on the post-encode path), cleanup fired for all 3 dirs with `sizes===[]`, `deletedMidReencode===1`, `processed===0`, all failure counters 0, `lastRunHadFailures===false`. |
| **AGG-R8c3-04** `text-destructive` dark-mode contrast 1.99:1 (widest public a11y) | MED | `77013cd0` | **CONFIRMED-CLOSED (math-verified)** | New `--destructive-text` token in `globals.css`: light `0 73.7% 41.8%` (`:43`), **dark `0 90.6% 70.8%`** (`:69,:97`), oklch dark `oklch(71% 0.17 22)` (`:139,:147`). `ui/alert.tsx:13` switched to `text-destructive-text`. Migration breadth verified complete: **grep for bare `text-destructive` text-color usages returns EMPTY** — all 20 sites converted to `text-destructive-text`, including public `login-form.tsx` + the shared `ui/alert.tsx` primitive. I computed the contrast: OLD L=30.6% on dark `--card`(L=3.9%) = **1.98:1** (matches reported 1.99:1, fails); NEW L=70.8% on dark card = **7.16:1** (clears 4.5:1). Even the `[data-theme]` card (L=14.9%) → 5.38:1. WCAG failure genuinely resolved. |
| **AGG-R8c3-05** home page two uncached heavy GROUP_CONCAT queries | MED | `e9040d17` | **CONFIRMED-CLOSED (improved on plan)** | New `getLatestImageForOg` (`data.ts:873-887`) selects ONLY `{id, title}` (`:877`) — **no `leftJoin(imageTags)`, no `tagNamesAgg`/GROUP_CONCAT, no `groupBy`** (contrast `getImages` `:893-913` which has all three). Tag filter rides `buildImageConditions` as IN-subquery. And it's `cache()`-wrapped (`getLatestImageForOgCached` `:1597`) — the home metadata path uses the cached form (`page.tsx:93`), beating the plan's "uncached minimal query" target. Body still uses `getImagesLitePage` (`page.tsx:162`, the legitimate listing). Redundant heavy metadata query eliminated. |
| **AGG-R8c3-06** 24px alias button + scale-token audit blind spot | MED | `d70c1d98` | **CONFIRMED-CLOSED (probe-verified)** | `categories/topic-manager.tsx:333` button now `min-h-11 min-w-11` (was `min-h-6 min-w-6`). Audit `touch-target-audit.test.ts:341-356` adds 4 scale-token FORBIDDEN patterns (`(?:min-h\|min-w\|size\|h\|w)-(?:[1-9]\|10)` on `<Button>`/`<button>`, literal + cn(), with a `≥44` override lookahead). I **probed the regexes directly**: live-bug `min-h-6 min-w-6` → matches (true); fixed `min-h-11 min-w-11` → does NOT match (false, lookahead works); `size-6` + cn()`min-h-7` → match. Genuinely closes the blind spot. |
| **AGG-R8c3-07/08** amber dark-mode contrast ×2 | LOW | `ecd093ab` | **CONFIRMED-CLOSED** | `histogram.tsx:608` now `text-amber-700 dark:text-amber-300` (sRGB-preview span); `settings/settings-client.tsx:674` now `text-amber-700 dark:text-amber-400` (was the outlier `text-amber-600` no-dark). |
| **AGG-R8c3-11 (TEST-1/2/3)** + **16(a)** test depth + migrate tripwire | LOW | `6454c4a3` (+`0028ede4` TEST-1) | **CONFIRMED-CLOSED (all 3 non-vacuous)** | **TEST-1:** home OG route `api/og/route.tsx` now pinned at `sanitize-for-og-global.test.ts:68` (`it.each` import assertion). **TEST-2:** new `describe` block at `admin-backfill-runner-fatal-counters.test.ts:314+` uses `width: 0` and asserts `encodeFailures===1`, `processed===0`, `processImageFormats NOT called`, **zero `UPDATE images SET` calls** — strong data-integrity contract. **TEST-3:** `sw-template-contract.test.ts:118-134` asserts `method:'HEAD'` + `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` + the timeout const in BOTH `sw.template.js` AND generated `sw.js`. **16(a):** `migrate-reconcile-coverage.test.ts:42-50` adds `stripJsComments` (block `:45` + line `:47`) → `MIGRATE_SRC_CODE`; column (`:100`) and index (`:166`) tripwires now match comment-stripped source — a name in a comment no longer satisfies. |
| **AGG-R8c3-14** CLAUDE.md doc-completeness ×4 | LOW | `5f097262` | **CONFIRMED-CLOSED** | All 4 present at HEAD: DOC-1 SW bounded HEAD `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` 300ms (`CLAUDE.md:369`); DOC-2 raw checkbox/radio scanner (`:513`) + scale-token pattern; DOC-3 og-sanitize runtime layer + all 3 consumers (`:181`); DOC-4 per-photo OG card route + home og:image→it via `getLatestImageForOgCached` (`:101-102`). |
| **AGG-R8c3-16(b)** localize `retryFailedImage` invalid-id string | LOW | `6be638d2` | **CONFIRMED-CLOSED** | `images.ts:1087` now `t('invalidImageId')` (matches siblings `:553,659,806,887`). Key present in BOTH `en.json` and `ko.json` (1 each) → parity holds. |

### 2b. Deliberately DEFERRED to plan-336 (RECORDED, severity preserved) — 7 findings

These were NOT claimed code-fixed; they are recorded in `plan-336-run8-cycle3-deferred.md` with preserved severity + exit criteria. This is consistent with the repo's deferred-fix rule (LOW hygiene / record-only / already-owned). I confirmed each is genuinely deferred, not silently dropped:

| Finding | Sev | plan-336 entry | Disposition |
|---|---|---|---|
| AGG-R8c3-09 encode-test parallelism flake | LOW | Deferred 1 | test-infra noise; warm-green (and did not reproduce for me) |
| AGG-R8c3-10 SW meta lost-update (no CAS) | LOW | Deferred 2 | best-effort cache by design |
| AGG-R8c3-12 lib→app layering inversion | LOW | Deferred 3 | no live ESM cycle; refactor-scope |
| AGG-R8c3-13 triplicated ICC token ladder | LOW | Deferred 4 | DRY; land with WI-09 keyword |
| AGG-R8c3-15 stale `KNOWN_VIOLATIONS['image-manager.tsx']=6` | LOW | Deferred 5 | **VERIFIED still 6** at `touch-target-audit.test.ts:182`, untouched this cycle — correctly deferred ("recount after Item 4"), NOT a missed fix |
| AGG-R8c3-17 design polish (DES-5/6/7) | LOW | Deferred 6 | no WCAG fail; polish pass |
| AGG-R8c3-A1..A5 + OWNED-1 (Stripe ACH) | LOW–HIGH | Deferred 7–11 | record-only tradeoffs; Stripe ACH already plan-316 (fails CLOSED, repo-rule-permitted) |

**Note on AGG-R8c3-16(c) (CRT-3 home-og comment honesty):** this was a sub-item of AGG-R8c3-16; the substantive 16(a) tripwire + 16(b) i18n shipped. The comment-honesty nuance is subsumed by the DOC-4 CLAUDE.md update (`:101-102`) which now accurately states `pickFirstAvailablePhotoBuffer` behavior and the home og:image target. No outstanding falsehood found.

---

## 3. New correctness issues found while verifying

**None.** I specifically stress-tested the high-risk areas:
- **Backfill orphan-cleanup polarity** (AGG-R8c3-03): the `sizes=[]` directory-scan semantics are correct (`process-image.ts:505`), both UPDATE branches guarded symmetrically, counter partition exact. No regression to the f3667858 mixed-run counter contract.
- **text-destructive migration breadth** (AGG-R8c3-04): grep confirms ZERO bare `text-destructive` text-color usages remain — no public surface (login/validation) missed.
- **Scale-token audit non-vacuity** (AGG-R8c3-06): direct regex probe confirms the patterns fire on the exact live-bug shape and correctly exempt the fix.
- **og-sanitize C0-parity** (AGG-R8c3-02): the shared function's C0-strip is behaviorally tested; the import is structurally pinned for all 3 consumers.
- **NCLX code-2 test reachability** (AGG-R8c3-01): the helper writes a real AVIF box, not a stub — the guard path is genuinely exercised.

All claimed pinning tests assert the right behavior (no vacuous `expect(true).toBe(true)` or import-only checks where behavior matters). The SW TEST-3 and backfill TEST-2 in particular are strong contracts.

---

## 4. Summary

- **Gates:** 6/6 green (lint 0, typecheck 0, 3 security lints 0, vitest 2067/2067 pass exit 0) + i18n parity 837=837.
- **Findings claimed code-fixed (10):** **10/10 CONFIRMED-CLOSED**, all with present+correct code and non-vacuous tests. Two MED items (AGG-R8c3-04 contrast, AGG-R8c3-06 audit) additionally hand-verified by independent computation/probe.
- **Findings deferred (7):** all genuinely RECORDED in plan-336 with preserved severity; none falsely closed (notably AGG-R8c3-15 KNOWN_VIOLATIONS=6 correctly left for the deferred plan).
- **New issues:** 0. **Incomplete fixes:** 0. **Regressions:** 0.

**Recommendation: APPROVE.** The run-8 cycle-3 batch does what it claims; this is a convergence-clean cycle.
