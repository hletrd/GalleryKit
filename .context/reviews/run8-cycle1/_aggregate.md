# Aggregate Review — Run-8 Cycle-1 (HEAD `47b1e21f`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD `47b1e21f`):** ESLint exit 0; lint:api-auth (2 routes) / lint:action-origin (44 exports = 38 OK + 6 exempt) / lint:public-route-rate-limit (6 public route files) all exit 0; typecheck (app + scripts, 7 JS files) exit 0; Vitest **2024 passed / 4 skipped / 0 failed** (221 files passed + 2 skipped = 223). The 4 skips are exclusively the CLIP-weight-gated suites (`clip-offline-load.test.ts` ×2, `clip-semantic-integration.test.ts` ×2), gated by design on `SEEDED`/`RUN` env vars, NOT removal-induced. Next.js prod build exit 0 (**38 routes**; **0 ENOENT warnings** — run-7's 3 dev-fixture warnings are GONE). `npm audit --omit=dev`: 0 critical / 0 high / **2 documented moderate** (postcss `<8.5.10` via `next@16.2.6` internals, build-time-only, unchanged from run-7 — removing the `stripe` dep added NO new vulnerabilities and changed the audit surface only by subtraction).

## Context

This is cycle-1 of run-8. Run-7 converged at cycle-6 with ZERO findings (source was byte-identical to the converged cycle-5 HEAD). **SINCE THEN a large change landed: the complete removal of the Stripe paid-download feature** (6 commits `6c5e0b61`..`47b1e21f`):
- **DELETED** routes `api/stripe/webhook`, `api/checkout/[imageId]`, `api/download/[imageId]`; libs `stripe.ts`, `license-tiers.ts`, `download-tokens.ts`, `download-interstitial.ts`; `actions/sales.ts`; admin `sales/page.tsx` + `sales-client.tsx`; the `entitlements` table + `images.license_tier` column (migration `0023`); the `stripe` npm dep; paid i18n keys; ~17 paid-download test files.
- **MODIFIED** to remove wiring: `photo-viewer.tsx` (−108), `info-bottom-sheet.tsx`, `settings-client.tsx` (−56), `bulk-edit-dialog.tsx` (−42), `bulk-edit-types.ts`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `actions.ts`, `actions/images.ts`, `api/admin/db/download/route.ts`, `api/admin/lr/upload/route.ts`, `api/search/semantic/route.ts`, `db/schema.ts`, `data.ts`, `gallery-config-shared.ts`, `gallery-config.ts`, `gps-exif-strip.ts`, `process-image.ts`, `rate-limit.ts`, `scripts/migrate.js`, `messages/{en,ko}.json`, `package.json`, `package-lock.json`.
- **KEPT** and made UNCONDITIONAL: the free direct-download button (Download JPEG/AVIF, gamut-aware) in `photo-viewer.tsx` + `info-bottom-sheet.tsx`.

This cycle's review angle: a deep skeptical sweep of the removal's blast radius (dangling refs, free-download correctness, migration/reconcile correctness, half-removals, doc-code drift, coverage gaps, carried-deferral mootness), plus a fresh whole-repo sweep from every angle.

**Headline result: the removal is surgically clean and strictly REDUCES attack surface.** Zero correctness / security / data-loss / HIGH / CRITICAL findings from any of the 11 agents. The only actionable residue is **cosmetic dead-data / stale-comment cleanup** (one orphaned i18n namespace with misleading "purchase/single-use" copy + a handful of stale source/test comments + one dead test-fixture line) plus **two LOW/MED test-coverage gaps** for the now-unconditional free-download path. Several carried deferrals are now **MOOT** (target code deleted), and the carried privacy residual **RES-R7C6-01 is now CLOSED** (its only leak vector — the paid-download route that streamed the on-disk original — was deleted).

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| Removal complete — NO dangling import/type/re-export/JSX/registry reference to any deleted symbol | code-reviewer (typecheck PASS proves zero dangling types), security-reviewer, architect, critic (H1 SURVIVED), debugger (grep + both INSERT sites clean), verifier (#13 zero matches), perf-reviewer | **CONFIRMED CLEAN** (7 agents) |
| Free-download path intact + null-safe (`photo-viewer.tsx:176-188,927-974`; `info-bottom-sheet.tsx:153-165`) | code-reviewer, critic (H2 SURVIVED), tracer (FLOW-A CLEAN), debugger, verifier (#16), designer | **CONFIRMED CLEAN** (6 agents) |
| Migration 0023 + reconcileLegacySchema correct on fresh + incremental + partial DB; journal `when` monotonic; post-condition won't false-fail | architect (highest-signal arch item), critic (H3 SURVIVED), tracer (FLOW-C CLEAN), debugger, verifier (#14,#15) | **CONFIRMED CLEAN** (5 agents) |
| **Orphaned `downloadPage` i18n namespace** (en.json/ko.json:63-69, 5 keys each) — zero live consumers, "after purchase / single-use" copy now misleading | code-reviewer (LOW-R8C1-01), architect (LOW-R8C1-02), critic (INFO), document-specialist (DS-R8C1-03), designer (MED-R8C1-01) | **CONFIRMED — actionable cleanup** (5 agents) |
| **RES-R7C6-01 (HEIC GPS-strip residual) reachability CLOSED** by the removal (deleted route was the only public consumer of the on-disk original) | security-reviewer (CLOSED), tracer (FLOW-B CLOSED, every remaining consumer internal), debugger (MITIGATED), architect (RE-SCOPE), critic (neutralized) | **CONFIRMED CLOSED/RE-SCOPE** (5 agents) |
| Carried deferrals **ARCH-R7C2-01** (`charge.refunded`) + **TE-R7C2-02** (stripe-webhook behavioral) now MOOT — target route deleted | architect, test-engineer, tracer, verifier, debugger, critic | **CONFIRMED MOOT** (6 agents) |
| Stale "paid-download" comments in source + test docstrings (`process-image.ts:1547`; 3 test files) | architect (LOW-R8C1-03), document-specialist (DS-R8C1-01/02), test-engineer (noted) | **CONFIRMED — cosmetic** (3 agents) |
| Dead `licensePrices` fixture line `serve-upload-settings-debounce.test.ts:34` | architect (LOW-R8C1-01), critic (highest-signal item) | **CONFIRMED — dead data** (2 agents) |
| CLAUDE.md / README / AGENTS.md / .env.local.example / site-config already cleaned of paid-download (the stale copy is only in THIS session's injected system-reminder, NOT on disk) | architect, critic (H4 SURVIVED — prediction WRONG), document-specialist (grep-confirmed clean) | **CONFIRMED CLEAN** (3 agents) — corrects the run premise |
| No perf regression — removal is strictly subtractive on every hot path | perf-reviewer (N, with evidence) | **CONFIRMED** |
| Touch-target gate PASS; KNOWN_VIOLATIONS budget unchanged (17/8); no dangling /sales nav link | designer | **CONFIRMED CLEAN** |

---

## SCHEDULED findings (this cycle)

All are cosmetic dead-data / stale-comment cleanup + test-coverage hardening — none are correctness/security/data-loss. They are grouped into ONE coherent cleanup pass.

### FIND-R8C1-01 [LOW, conf HIGH] — Orphaned `downloadPage` i18n namespace with misleading copy
**Agents (5):** code-reviewer, architect, critic, document-specialist, designer (designer rated MED for maintenance-confusion + future-tooling-false-positive).
**Where:** `apps/web/messages/en.json:63-69` and `apps/web/messages/ko.json:63-69` (the `downloadPage` block, 5 keys: `title`, `description`, `descriptionNoTitle`, `button`, `expiryNote`).
**Problem:** the namespace was consumed exclusively by the deleted paid-download interstitial route (`api/download/[imageId]/route.ts`, confirmed via git history). Commit `961a7f1f` removed `stripe.*`/`sales.*`/`licensePrice.*` but MISSED this block. Zero live consumers (`grep -rn downloadPage apps/web/src` = 0). The copy is now actively WRONG: `expiryNote` says "valid for 24 hours **after purchase** and can be used **once**" — there is no purchase and no single-use token anymore. Symmetric across locales so the key-parity gate passes (which is why it slipped through).
**Fix:** delete the `downloadPage` block from both `en.json` and `ko.json` (preserves 784=784 parity).
**Confidence:** HIGH, confirmed.

### FIND-R8C1-02 [LOW, conf HIGH] — Stale "paid-download" / "paid deliverable" comments in surviving source + test docstrings
**Agents (3):** document-specialist (DS-R8C1-01/02), architect (LOW-R8C1-03), test-engineer (noted, not vestigial).
**Where:**
- `apps/web/src/lib/process-image.ts:1547` — `// quality (JPEG q80 / HEIF q50), silently degrading the paid` / `// deliverable.` (HISTORY docblock of `stripGpsFromOriginal`).
- `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts:6,12` — "paid-download route streams byte-for-byte" / "leaking GPS to paid downloads".
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:74` — "paid-download purchasers" (commit `961a7f1f` fixed 2 other lines here but missed :74).
- `apps/web/src/__tests__/strip-gps-from-original.test.ts:263` — "readable in the paid-download ORIGINAL".
**Problem:** no paid-download route exists; the original is no longer streamed to any HTTP client. The test LOGIC and assertions remain correct (GPS stripping of the on-disk original is still required — admins can still download it via the authenticated admin path / it's the CLIP/backfill source), only the threat-model RATIONALE in the comments is stale. NOT a behavioral defect — pure doc drift.
**NOTE — explicitly NOT stale (do not "fix"):** `process-image.ts:1108` "Only paid on the wide-gamut path" — here "paid" is the English idiom for "computationally expensive/incurred," verified correct by document-specialist; leave it.
**Fix:** replace the stale phrases with "the on-disk original" / "the admin-downloadable original".
**Confidence:** HIGH, confirmed.

### FIND-R8C1-03 [LOW, conf HIGH] — Dead `licensePrices` fixture line in a surviving test
**Agents (2):** critic (its single highest-signal item), architect (LOW-R8C1-01).
**Where:** `apps/web/src/__tests__/serve-upload-settings-debounce.test.ts:34` — `licensePrices: { editorial: 0, commercial: 0, rm: 0 },` inside the `FAKE_CONFIG` object literal.
**Problem:** `licensePrices` is gone from the `GalleryConfig` type (verified: zero hits in `gallery-config-shared.ts`/`gallery-config.ts`/`image-types.ts`). The sibling `settings-hash.test.ts` had its identical fixture line correctly removed in the same cleanup; THIS file was missed. Harmless today (untyped object literal → no excess-property check → typecheck passes; the runtime mock ignores the extra key), but it will surface as a confusing `tsc` excess-property error the moment anyone hardens `FAKE_CONFIG` with `satisfies GalleryConfig`.
**Fix:** delete line 34.
**Confidence:** HIGH, confirmed.

### FIND-R8C1-04 [MEDIUM, conf HIGH] — Free-download unconditional path has no source-contract coverage (test gap)
**Agent:** test-engineer (GAP-R8C1-TE-01).
**Where:** `apps/web/src/components/photo-viewer.tsx` (download section ~927-974) + `apps/web/src/components/info-bottom-sheet.tsx` (download section ~491-520). The download UI now renders unconditionally (gated only on `image.filename_jpeg` non-null) with a new gamut-aware AVIF branch (`isWideGamutSource && avifDownloadHref` → 2-item DropdownMenu).
**Problem:** no test verifies: (a) the components condition download on NO `entitlement`/`license`/`downloadToken` symbol (regression-guard that paid-gating cannot creep back), (b) `buildDownloadFilename` is called for both JPEG and AVIF, (c) `avifDownloadHref` is derived from `filename_avif` separately from `downloadHref`. The deleted tests were the closest coverage; `download-filename.test.ts` covers only the util, `photo-viewer-no-hdr-download.test.ts` covers only HDR absence, `info-bottom-sheet-ia.test.ts` covers IA order not href correctness. A future regression that re-introduces a license gate, or breaks the AVIF href derivation, would slip through.
**Fix:** add a source-contract test (mirroring the repo's existing source-contract test style) asserting both components import + call `buildDownloadFilename`, derive both hrefs from the respective filename fields, and contain no entitlement/license/downloadToken reference.
**Confidence:** HIGH (gap is real); severity MEDIUM because it's the primary user-facing deliverable surface for a free gallery and the removal made it unconditional with zero new coverage.

### FIND-R8C1-05 [LOW, conf MEDIUM] — Migration 0023 reconcile drops not tripwired by a test
**Agent:** test-engineer (GAP-R8C1-TE-02).
**Where:** `apps/web/scripts/migrate.js:627-628` (`dropTableIfPresent('entitlements')` + `dropColumnIfPresent('images','license_tier')` in `reconcileLegacySchema`).
**Problem:** the existing reconcile-coverage tripwire (`migrate-reconcile-coverage.test.ts`) walks the CURRENT `schema.ts` tables to assert each is CREATE-guarded — but a DROPPED table/column no longer appears in `schema.ts`, so a regression that silently removes the two drop calls would go undetected, leaving a stale `entitlements` table + `license_tier` column on a legacy DB forever. Risk LOW (the DDL is `IF EXISTS`/INFORMATION_SCHEMA-guarded and the feature was never used in production — 0 entitlement rows, all `license_tier='none'`).
**Fix:** add a small assertion (source-contract or behavioral) that `reconcileLegacySchema` contains both drop calls.
**Confidence:** MEDIUM.

---

## Carried deferrals now MOOT (planner should CLOSE — target code deleted)

- **ARCH-R7C2-01** [LOW] — `charge.refunded` Stripe webhook gap. The webhook route is DELETED. **MOOT — CLOSE.** (architect, test-engineer, tracer, debugger, critic, verifier all concur.)
- **TE-R7C2-02** [LOW] — Stripe webhook route 0% behavioral coverage. Route + its source-contract test both deleted. **MOOT — CLOSE.** (test-engineer, verifier, debugger, tracer.)

## Carried residual now CLOSED (downgrade from "reachability unverified" to CLOSED)

- **RES-R7C6-01** (= RES-R7C5-01 …) — HEIC anomaly GPS-strip fall-through. The GPS-retention branch at `process-image.ts:1628-1634` still exists, but the ONLY consumer that streamed the on-disk original to an HTTP client (the deleted `api/download` route) is GONE. Every remaining reader of `data/uploads/original/` is internal server-side (write-time strip, queue/backfill decode, CLIP embedding at `embeddings.ts:132`, delete) with no public HTTP response path; `original/` stays excluded at both app (`ALLOWED_UPLOAD_DIRS` = jpeg/webp/avif) and nginx (`location ^~ /uploads/original/ { return 404; }`); DB lat/long are nulled before the strip runs (`images.ts:312-316`). **The privacy-leak vector no longer exists — CLOSE.** Re-open exit criterion (preserved): if any future feature re-introduces a route that streams from `data/uploads/original/`, RES-R7C6-01 re-opens at HIGH/CRITICAL and the anomalous-HEIC branch must be fixed before that route ships. (security-reviewer, tracer, debugger, architect [re-scope], critic.)

---

## Carried-forward deferrals (re-verified UNCHANGED, no new evidence, no exit criterion met — full register in `.context/plans/run8-cycle1/deferred.md`)

- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified; out of touch-target-audit scope by design. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (no new evidence).
- **TE-R7C2-03** [LOW] — semantic route malformed-embedding row-skip untested. Route still exists (modified −6 lines = comment-only per debugger/code-reviewer). Carried.
- **TE-R7C2-04** [LOW] — `logAuditEvent` metadata-truncation untested. Carried.
- **TE-R7C2-05** [INFO] — `embeddings.ts` action no dedicated test. Carried.
- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry; updateTopic no FOR UPDATE. Carried (documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.

---

## Refuted / disproved / verified-non-finding (do NOT re-file — recorded so the next cycle doesn't re-litigate)

- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way cycle-2; not re-filed by any agent cycles 3-6 or this cycle. Stays refuted.
- **REJ-R7C3-01** — `indexSize` not validated against {0,4,8} (`gps-exif-strip.ts:466`) — DISPROVED cycle-3, re-confirmed disproved cycles 4/5/6; the removal touched `gps-exif-strip.ts` only by a −2 comment edit (debugger/security confirmed functional logic byte-identical). Stays disproved.
- **NF-R7C4-01** — `color-detection.ts:185` code-4 comment "BT.470M, NTSC 525-line" — VERIFIED CORRECT vs H.273. Stays verified non-finding.
- **NF-R7C5-01** — `migrate.js` `baselineAllJournalMigrations` "duplicate rows on retry" — REFUTED (filters on missing-hash Set). Stays refuted.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist re-confirmed `IMAGE_PIPELINE_VERSION=7` and `COLOR_IMPACTING_KEYS=9` still match between CLAUDE.md and code; no regression. Class closed.
- **process-image.ts:1108 "Only paid on the wide-gamut path"** — NOT stale; "paid" = English idiom for "computationally expensive." Do NOT "fix" it.
- **CLAUDE.md/README stale-docs (the run-premise hypothesis)** — REFUTED: on-disk docs were already cleaned by commit `961a7f1f`; the stale copy is only in the injected system-reminder. (critic H4 prediction explicitly fell to "clean.")

---

## Non-findings noted for provenance (NOT filed)

- perf-reviewer INFO ×2 — `reconcileLegacySchema` now runs 2 idempotent drops + ~2 INFORMATION_SCHEMA lookups on the once-per-DB reconcile path. Not a request hot path; non-actionable.
- designer LOW-R8C1-01 (their numbering) — `DropdownMenuTrigger` has no explicit `aria-label`, but Radix injects `aria-haspopup="menu"` + toggles `aria-expanded`, so a11y is functionally correct. Optional only; not filed.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 1 LOW | APPROVE — removal exceptionally clean; typecheck PASS proves zero dangling types; free-download null-safe; migration 0023 robust; only orphaned `downloadPage` i18n namespace. |
| security-reviewer | 0 (1 disposition change) | LOW risk — removal surgically REDUCES attack surface (deletes 3 routes + 4 libs + entitlements table holding `customerEmail` PII + `downloadTokenHash` secret). RES-R7C6-01 CLOSED. ARCH-R7C2-01 / TE-R7C2-02 moot. audit unchanged (2 moderate postcss-via-next). |
| architect | 3 LOW | Removal architecturally complete; migration dual-path correct; CLAUDE.md/README already clean (corrects run premise). 3 cosmetic LOWs (dead fixture line, orphaned i18n, stale comments). ARCH-R7C2-01 + TE-R7C2-02 MOOT; RES-R7C6-01 re-scope. |
| critic | 1 LOW + 1 INFO | ACCEPT — 4 of 5 adversarial hypotheses SURVIVED falsification (clean); only H5 fell to ONE dead test-fixture line (`serve-upload-settings-debounce.test.ts:34`). RES-R7C6-01 neutralized. Genuine convergence-quality removal. |
| verifier | 0 blockers | PASS — all 8 gates green; 2024 pass / 4 CLIP-gated skips / 0 fail / 223 files; build 38 routes / 0 ENOENT; audit 2 moderate. 18/18 spot-checks VERIFIED. ARCH-R7C2-01 / TE-R7C2-02 recommend close. |
| test-engineer | 2 NEW (1 MED, 1 LOW) | Suite HEALTHY — no surviving test imports a deleted module; 0 vestigial; 6 deleted cycle*-rpf-source-contracts verified to pin ONLY paid-download (clean). NEW: free-download contract gap (MED), migration-drop tripwire (LOW). TE-R7C2-02 MOOT. |
| perf-reviewer | 0 (2 INFO) | No perf regression (N) — strictly subtractive on every hot path; masonry queries / tagNamesAgg / 5 images indexes unchanged; deleted 2 entitlements-only indexes; deleted a useState/ref/useEffect/Intl IIFE (fewer re-renders). |
| tracer | 0 confirmed defects | All 4 flows CLEAN (FLOW-A free download, FLOW-B original consumers, FLOW-C migration 0023, FLOW-D config). RES-R7C6-01 CLOSED with every remaining-consumer file:line enumerated. ARCH-R7C2-01/TE-R7C2-02 should be archived. |
| debugger | 0 | CLEAN PASS — `license_tier` INSERT/UPDATE mismatch verdict NEGATIVE (both INSERT sites read in full: `images.ts:333-379`, `lr/upload:343-393` — no `license_tier`). Every modified file is comment-only or correct DDL. RES-R7C6-01 mitigated; ARCH-R7C2-01/TE-R7C2-02 moot. |
| document-specialist | 3 LOW (6 occurrences) | CLAUDE.md/README/AGENTS.md/.env.local.example/site-config CLEAN (grep-confirmed; injected reminder is stale, on-disk is not). 3 doc-drift LOWs: process-image.ts:1547 comment, 3 test docstrings, orphaned downloadPage namespace. IMAGE_PIPELINE_VERSION=7 / COLOR_IMPACTING_KEYS=9 still match. |
| designer | 1 MED + 1 LOW (2 INFO) | Touch-target gate PASS; KNOWN_VIOLATIONS budget unchanged 17/8 (sales-client was never counted); NO dangling /sales nav link; all download controls min-h-11. MED = orphaned downloadPage i18n (dedup of FIND-R8C1-01). LOW = optional dropdown aria-label. |

**Net DISTINCT schedulable findings this cycle: 5** (3 cosmetic-cleanup LOW: FIND-R8C1-01 orphaned i18n, FIND-R8C1-02 stale comments, FIND-R8C1-03 dead fixture line; 2 test-coverage: FIND-R8C1-04 free-download contract MED, FIND-R8C1-05 migration-drop tripwire LOW) — after deduping the orphaned-i18n item flagged independently by 5 agents.
**Carried deferrals now MOOT: 2** (ARCH-R7C2-01, TE-R7C2-02).
**Carried residual now CLOSED: 1** (RES-R7C6-01).
**Refuted/disproved/verified-non-finding: 7.**
**Non-findings noted for provenance: 2.**

**Convergence signal:** the run-7 convergence held — this cycle's findings exist ONLY because a large subtractive change landed since. The removal is correct (all 8 gates + 2024 tests green; no dangling refs; migration dual-path sound; no perf/security regression; attack surface reduced; RES-R7C6-01 leak vector eliminated). The 5 schedulable items are all low-risk hygiene (dead data, stale comments, two coverage gaps) — none are correctness/security/data-loss, none block. They are fixed in this cycle's plan as one coherent cleanup + two test-additions.

## AGENT FAILURES

The tracer (agentId `a381d539e648f3ae3`) ended its first turn after evidence-gathering without writing its review file. Per protocol it was retried ONCE via SendMessage (resume-from-transcript); on the retry it completed all 4 flow traces and persisted `tracer.md` (291 lines). No other agent required re-dispatch; all 11 returned and persisted on the first pass otherwise.
