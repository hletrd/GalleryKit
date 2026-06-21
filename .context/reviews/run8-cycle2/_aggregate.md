# Aggregate Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD `f63af3b9`):** ESLint exit 0; lint:api-auth (2 routes OK) / lint:action-origin (44 exports = 38 OK + 6 exempt) / lint:public-route-rate-limit (6 public route files) all exit 0; typecheck (app + scripts, 7 JS files) exit 0; Vitest **2036 passed / 4 skipped / 0 failed** (222 files passed + 2 skipped = 224). The 4 skips are exclusively the CLIP-weight-gated suites (`clip-offline-load.test.ts` ×2, `clip-semantic-integration.test.ts` ×2), gated by design on `SEEDED`/`RUN` env vars. Next.js prod build exit 0 (**38 routes**; **0 ENOENT warnings**). `npm audit --omit=dev`: 0 critical / 0 high / **2 documented moderate** (postcss `<8.5.10` via `next@16.2.6` internals, build-time-only, unchanged from cycle-1). The **+12 test / +1 file** delta vs cycle-1 (2024→2036) is exactly the cycle-1 coverage additions (`free-download-contract.test.ts` FIND-R8C1-04 + the migrate-reconcile drop tripwire FIND-R8C1-05) landing at this HEAD — confirms cycle-1 shipped, not a regression.

## Context

This is cycle-2 of run-8. Run-8 cycle-1 found a LOW/MED cleanup tail of the Stripe paid-download removal (orphaned `downloadPage` i18n namespace, stale comments, dead `licensePrices` fixture line, a free-download contract test gap, a migrate-reconcile drop tripwire gap). **All 5 cycle-1 findings (FIND-R8C1-01..05) were implemented, committed, SW-stamped, and deployed** (commits `47b1e21f`..`f63af3b9`). HEAD is now `f63af3b9` (one SW-stamp commit + the 5 fix commits past the cycle-1 aggregate's `47b1e21f` baseline).

The only on-disk diff between cycle-1 final HEAD context and this cycle is already-landed work; the diff `ea372e41..f63af3b9` is solely `public/sw.js` (the build-stamp commit). This cycle's review angle: a fresh deep skeptical whole-repo sweep from every angle, with explicit re-verification that the paid-download removal left no behavioral/correctness/security/data-loss surface, plus the mandatory bookkeeping close of two now-obsolete deferrals.

**Headline result: convergence holds. ZERO new actionable findings (correctness / security / data-loss / perf / coverage / a11y / doc-drift) from all 11 agents.** The codebase remains at the converged LOW-risk state. One adversarial "critical candidate" (tracer) was raised and **REFUTED on the spot** by direct code verification (see below). No commits are warranted this cycle beyond the mandatory deferred-register bookkeeping (which is local-only / gitignored and does not count as a code commit).

---

## Cross-agent agreement matrix (high-signal items)

| Finding / verdict | Agents agreeing | Net disposition |
|---|---|---|
| **NEW FINDINGS: 0** — convergence genuine | ALL 11 (code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer) | **CONFIRMED — 0 new** (11 agents) |
| Paid-download removal surgically clean — zero dangling import/type/JSX/registry/SQL/nginx reference to any deleted symbol (`stripe`/`entitlement`/`license_tier`/`checkout`/`downloadToken`/`license-tiers`/`sales`); typecheck PASS proves zero dangling types | code-reviewer, security-reviewer, architect, critic (H1/H4 REFUTED), debugger, perf-reviewer, document-specialist, tracer, verifier (#12) | **CONFIRMED CLEAN** (9 agents) |
| Free-download path intact, null-safe, no surviving entitlement/license gate; the admin-only `color_pipeline_decision` reference on the public-data download object is fully null-safe (`isP3Pipeline(undefined)→false`, no crash, no admin-data leak) | tracer (FLOW-A CLEAN — initially flagged "critical candidate", then REFUTED), code-reviewer (explicit non-finding), debugger, designer, critic (H6 REFUTED) | **CONFIRMED CLEAN** (5 agents) |
| Migration 0023 + reconcileLegacySchema correct on fresh/legacy/partial DB; journal `when` for 0023 (1782000000000) > prior max (1781687094232); drops mirrored at `migrate.js:627-628`; post-condition won't false-fail; FIND-R8C1-05 tripwire pins both drops | architect, critic (H5 REFUTED), tracer (FLOW-C CLEAN), debugger, test-engineer, verifier | **CONFIRMED CLEAN** (6 agents) |
| RES-R7C6-01 (HEIC GPS-strip residual) stays CLOSED — no surviving route streams `data/uploads/original/`; the only `UPLOAD_DIR_ORIGINAL` route refs are `statfs` disk probes | security-reviewer, tracer (FLOW-B CLEAN), critic (H4 REFUTED), debugger | **CONFIRMED CLOSED** (4 agents) |
| ETag / settings-hash `COLOR_IMPACTING_KEYS = 9` holds; `_ColorKeysAreSettingKeys` compile guard holds; CRT-D1 static-path caveat still accurate | architect, tracer (FLOW-D CLEAN), verifier (#10), document-specialist | **CONFIRMED CLEAN** (4 agents) |
| Data-access privacy derivation holds — `publicSelectFields` destructure-omit-derived from `adminSelectFields`; 3 compile-time guards hold; zero license/entitlement field remnants | architect, security-reviewer, debugger, test-engineer (privacy-fields.test.ts PASS) | **CONFIRMED CLEAN** (4 agents) |
| No perf regression — removal strictly subtractive on every hot path (dropped a column with no WHERE/JOIN change; deleted `checkoutRateLimit` Map + its `prune()`; deleted a `useState`/`useEffect`/per-render `Intl.NumberFormat`; comment-only `process-image.ts`) | perf-reviewer (with diff evidence), code-reviewer, debugger | **CONFIRMED** (3 agents) |
| Touch-target gate PASS; KNOWN_VIOLATIONS budget unchanged; download controls all `min-h-11` (≥44px); ARIA correct on the DropdownMenu JPEG/AVIF branch; no leftover purchase/buy/license/$ copy in components/messages | designer | **CONFIRMED CLEAN** |
| On-disk docs (CLAUDE.md/AGENTS.md/README) already clean of paid-download; `IMAGE_PIPELINE_VERSION=7`, `COLOR_IMPACTING_KEYS=9`, sw.js stamp `f63af3b9-p7` all match code | document-specialist, verifier, architect | **CONFIRMED CLEAN** (3 agents) |

---

## SCHEDULED findings (this cycle)

**None.** No agent produced a NEW actionable finding. Per REPO CONVENTIONS #6 (CONVERGENCE), the correct outcome is NEW_FINDINGS:0 / COMMITS:0; review artifacts are written to `.context/reviews/run8-cycle2/` and left untracked for the orchestrator to commit as provenance.

---

## Adversarial "critical candidate" raised and REFUTED (provenance — do not re-litigate)

**Tracer candidate:** "`getImage` uses `publicSelectFields` which omits `color_pipeline_decision`, yet `photo-viewer.tsx:934` calls `isP3Pipeline(image.color_pipeline_decision)` — possible crash or admin-data leak on the public download button."

**REFUTED by direct code verification (lead + tracer + code-reviewer):**
- `isP3Pipeline` (`color-pipeline-decisions.ts:60-65`) is fully null-safe: `if (!decision) return false;`. `isP3Pipeline(undefined)` → `false`, no throw.
- The wide-gamut branch gate `isWideGamutSource = isWideGamutPrimary(image?.color_primaries)` (`photo-viewer.tsx:189`) keys on `color_primaries`, which **is** a public field (`data.ts:241`), so the branch is reachable for public viewers — but inside it, the admin-only `color_pipeline_decision` (omitted at `data.ts:331`, `PrivacySensitiveKeys` at `data.ts:414`) is merely `undefined` for the public, so the label silently falls to the generic `downloadJpeg`. The AVIF anchor uses `avifDownloadHref` (public `filename_avif`, `photo-viewer.tsx:177`), never the admin field. **No crash, no admin-data leak, no entitlement gate.** This is byte-identical converged behavior (pre-existing through 7 runs, untouched by the removal). **NOT a finding.**

---

## Cosmetic INFO residual (raised by critic, deliberately NOT counted as a new finding)

- **critic H7 (INFO, cosmetic):** cleanup commit `1d1cc118` (FIND-R8C1-02) may have left two "download-original path" comment lines at `process-image.ts:1570` and `:1646`. The test-engineer independently re-read these and judged them **ACCURATE, not stale** ("the admin-internal original-file reader still exists" — the on-disk original IS still downloadable by admins via the authenticated admin path, and is the CLIP/backfill source). Two agents reached opposite cosmetic verdicts on pure comment text with zero behavioral impact; given the disagreement is over whether already-correct comments are phrased ideally, this is **NOT counted** as a new finding (counting it would be manufactured padding per REPO CONVENTIONS #6). Recorded here for provenance only; planner may optionally fold a one-word touch-up into any FUTURE cleanup, but there is no behavioral, correctness, or doc-contract issue.

---

## MANDATORY bookkeeping (REPO CONVENTIONS #3) — two deferrals CLOSED-OBSOLETE

The paid-download removal (run-8) deleted `app/api/stripe/webhook/route.ts` + `actions/sales.ts`. The two deferrals that pointed at them are now obsolete:

- **ARCH-R7C2-01** [was LOW] — `charge.refunded` webhook gap → **CLOSED-OBSOLETE** (feature removed run-8; route deleted). Was already marked CLOSED-MOOT in run-8 cycle-1's deferred.md; re-affirmed CLOSED-OBSOLETE in `.context/plans/run8-cycle2/deferred.md`. Not carried forward.
- **TE-R7C2-02** [was LOW] — Stripe webhook 0% behavioral coverage → **CLOSED-OBSOLETE** (route + its source-contract test deleted). Same disposition. Not carried forward.

This is local-only/gitignored bookkeeping in `deferred.md`; it does NOT make COMMITS>0.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `f63af3b9`, no new evidence, no exit criterion met — full register in `.context/plans/run8-cycle2/deferred.md`)

- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Out of touch-target-audit scope by design. Designer re-verified. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (no new evidence; perf-reviewer re-confirmed CR-02 not regressed).
- **TE-R7C2-03** [LOW] — semantic route malformed-embedding row-skip untested. Route unmodified by removal. Carried (test-engineer re-confirmed STILL OPEN).
- **TE-R7C2-04** [LOW] — `logAuditEvent` metadata-truncation untested. Carried (STILL OPEN).
- **TE-R7C2-05** [INFO] — `embeddings.ts` action no dedicated test. Carried (STILL OPEN).
- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry; updateTopic no FOR UPDATE. Carried (documented-design / operator-mitigated; security-reviewer re-confirmed OBS-R7C2-03/04 unchanged).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.

---

## Refuted / disproved / verified-non-finding (do NOT re-file — recorded so the next cycle doesn't re-litigate)

- **TRACER "color_pipeline_decision on public download object" candidate** — REFUTED this cycle (null-safe `isP3Pipeline`, admin field merely undefined for public). Do NOT re-file.
- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way; re-confirmed REFUTED this cycle (perf-reviewer at `histogram.tsx:322,332`). Stays refuted.
- **REJ-R7C3-01** — `indexSize` not validated against {0,4,8} (`gps-exif-strip.ts:466`) — DISPROVED ×4; `gps-exif-strip.ts` unchanged by the removal (checkout-artifact mtime only, byte-identical logic — security-reviewer confirmed via `git log 47b1e21f..HEAD`). Stays disproved.
- **NF-R7C4-01** — `color-detection.ts:185` code-4 comment "BT.470M, NTSC 525-line" — VERIFIED CORRECT vs H.273. Stays verified non-finding.
- **NF-R7C5-01** — `migrate.js` `baselineAllJournalMigrations` "duplicate rows on retry" — REFUTED (filters on missing-hash Set). Stays refuted.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist re-confirmed `IMAGE_PIPELINE_VERSION=7` and `COLOR_IMPACTING_KEYS=9` still match between CLAUDE.md and code. Class closed.
- **`process-image.ts:1108` "Only paid on the wide-gamut path"** — NOT stale; "paid" = English idiom for "computationally expensive." Do NOT "fix" it.
- **CLAUDE.md/README/AGENTS.md "stale paid-download docs" run-premise** — REFUTED (again): on-disk docs already cleaned by `961a7f1f`; the stale copy is only in the injected system-reminder, not on disk (document-specialist grep-confirmed).
- **ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook)** — CLOSED-OBSOLETE (route deleted). Do NOT re-open.

---

## AGENT FAILURES

None. All 11 agents returned. Two (tracer, document-specialist) returned their analysis summary but did not persist their review file on the first pass (final messages were truncated mid-work); both were re-spawned with their verified conclusions and persisted their files. All 11 provenance files exist in `.context/reviews/run8-cycle2/`.

---

## Disposition

- **NEW actionable findings:** 0
- **Scheduled fixes:** 0
- **Commits warranted (code):** 0 — convergence per REPO CONVENTIONS #6.
- **Deferred-register bookkeeping (local-only, gitignored):** ARCH-R7C2-01 + TE-R7C2-02 marked CLOSED-OBSOLETE; all other open deferrals carried forward unchanged.
- **Gate state:** all green.
- **Deploy:** none (zero commits → convergence).
