# Run-17 Cycle-17 Convergence — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 7b5c1943
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates:** eslint clean (exit 0), tsc clean (exit 0), vitest 2112 pass / 4 skip (verifier-confirmed; test-engineer added +4 → 2116 during its pass), 3 security lint gates OK.

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities. `npm audit` 0 vulns (security-reviewer re-ran). |
| HIGH | 0 | None runtime. (PERF-17-01 was labeled HIGH but is mis-attributed + scale-gated — see below.) |
| MEDIUM | 1 | **DBG-17-1 / CR-17-1 (HEADLINE, 5-agent)** — upload-tracker quota claim leaks when the topic-exists `db.select` (`images.ts:256-259`) throws. The CR-16-01 TOCTOU fix moved the claim (`:226-228`) BEFORE that un-`catch`-guarded `await`; the outer `try` (`:175`) is `finally`-only (`:561`, releases the contract lock, never settles). A transient DB error there inflates that admin+IP window by `+files.length`/`+totalSize` with zero files stored → false `uploadLimitReached`/`cumulativeUploadSizeExceeded` until the ≤1 h window expires. The disk pre-check (`:233-251`) got try/catch+settle; its sibling topic SELECT below it did not. Classic "fix one sibling, miss the next" — inside the very fix meant to harden the tracker. |
| LOW | ~6 | A11y focus-visible "missed siblings" of cycle-16 back-to-top fix (designer M-01/M-02/L-01); PERF-17-04 (per-image redundant `getGalleryConfig()` on NORMAL upload jobs — bootstrap path fixed in PERF-16-01, normal path missed); DBG-17-2 (upload-tracker under-count when window resets between claim+settle — pre-existing, needs-repro); security LOW parity nits (semantic query max-codepoint cap, similar-404 refund, `'unknown'` rate-limit bucket). |
| TEST-GATE | 3 | **GAP-1** smart_collections remap integration gate VACUOUS — `topics-actions.test.ts` mock returns rows without `query_json` so the loop `continue`s every iteration; reverting the whole smart_collections re-point passes all tests (verifier + test-engineer, **2-agent**). **GAP-2** `info-bottom-sheet.tsx:500` isAdmin gate UNTESTED — `photo-viewer-no-hdr-download.test.ts` only scans photo-viewer (verifier + test-engineer, **2-agent**). **GAP-3** `SEMANTIC_SCAN_LIMIT` `.limit()` unpinned in semantic route. (test-engineer AUTHORED fixes for all 3 during its pass — must verify non-vacuous before keeping.) |
| DOC | 4 | M-1 CLAUDE.md L290 `settings-hash.ts:42-54` → actual `45-57`; M-2 topic-rename description (L373) omits `topic_views` + `smart_collections` re-points added cycle-16; M-3 upload TOCTOU fix absent from Race Condition Protections; M-4 `image_views(image_id, viewed_at)` index (migration 0010) missing from Database Indexes. |
| ARCH/DEFER | — | A1 (STRUCTURAL HIGH) `topics.slug` rename fan-out has no single source of truth / no `ON UPDATE CASCADE` — recurring missed-sibling root; A2 (STRUCTURAL MED-HIGH) public `api/search/**` enrichment selects PII outside the compile-guarded privacy system (cycle-16 regex fixture is a denylist band-aid); PERF-17-01/02/03/06/07 (scale-gated/mis-attributed); critic M2 (smart-collection `contains`/range topic predicate not remapped — documented), M3 (rename lock window lengthened); designer blue-outline→`ring-ring` token unification (repo-wide consistency, not a hard WCAG fail in modes actually used). |
| FALSE-POSITIVE | 1 | PERF-17-05 (`home-client.tsx:53` "RAF not cancelled") — line 52 ALREADY calls `cancelAnimationFrame(rafId)` before rescheduling. Not a defect. |

**Verdict:** Mature, well-hardened codebase. All cycle-16 fixes verified individually correct (verifier 10/12 fully; 2 had vacuous/missing gates now patched by test-engineer). This cycle's signal: ONE genuine availability bug (DBG-17-1, a new missed-sibling INSIDE the CR-16-01 fix — flagged by 5 agents independently), TWO vacuous/missing test gates from cycle-16 (GAP-1/GAP-2), ONE real per-image config-read inefficiency (PERF-17-04, missed sibling of PERF-16-01), and several a11y focus-indicator siblings the cycle-16 back-to-top fix didn't sweep.

---

## Lead verification (read against installed code before planning)

1. **DBG-17-1 / CR-17-1 — CONFIRMED (MEDIUM, availability, 5-agent: code-reviewer/critic/verifier-implicit/tracer/debugger).** `images.ts:226-228` claim; `:233-251` disk check has try/catch+settle; `:256-259` topic SELECT has NO try/catch; outer `try` `:175` → `} finally {` `:561-563` releases `uploadContractLock` only. A throw at :256 escapes past finally without settling → claim leaks until window expiry (`upload-tracker.ts` WINDOW_MS = 1 h). Self-healing + not attacker-triggerable → severity MEDIUM/LOW. **Fix:** wrap :256-259 in try/catch that calls `settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, 0, 0)` then re-throws (preserve the existing 500 propagation; zero files committed at that point so 0/0 settle is exact). NOT deferrable (the disk-check sibling proves the correct pattern is already established right above it).
2. **GAP-1 — CONFIRMED (test-gate, 2-agent).** `topics-actions.test.ts` `txSelect` mock returns `{slug, image_filename, map_visible}` (no `query_json`); `topics.ts` smart_collections loop `if (typeof collection.query_json !== 'string') continue` → never reaches `tx.update(smartCollections)`. Reverting the entire loop passes all tests. test-engineer added a `mockReturnValueOnce` scenario asserting the remapped AST is written.
3. **GAP-2 — CONFIRMED (test-gate, 2-agent).** `info-bottom-sheet.tsx:500` `isAdmin && isP3Pipeline(...)` untested; removing the gate from info-bottom-sheet alone passes all tests. test-engineer extended `photo-viewer-no-hdr-download.test.ts` with a `BOTTOM_SHEET_PATH` read + regex.
4. **GAP-3 — CONFIRMED (test-gate).** Semantic route `.limit(SEMANTIC_SCAN_LIMIT)` unpinned; removing it → unbounded scan, all tests pass. test-engineer added `semantic-scan-limit-source.test.ts`.
5. **PERF-17-04 — CONFIRMED (LOW-MED perf).** `image-queue.ts:385-407` resolves `resolvedSemanticMode` only on the bootstrap path (`!quality && !imageSizes`); normal jobs (carry quality+sizes) leave it `null` → embedding IIFE (`:511-514`) calls `getGalleryConfig()` per image (cache() is request-scoped, no-op in queue worker) → 1 redundant `SELECT admin_settings` per processed image when semantic search is on (it IS, in production). **Fix:** snapshot `semanticSearchMode` into `ImageProcessingJob` at enqueue (consistent with quality/sizes/chroma which are already snapshotted); read `job.semanticSearchMode` in the IIFE; bootstrap path keeps its config-derived resolve.
6. **Designer a11y — CONFIRMED genuine gaps (LOW-MED).** `nav-client.tsx:94` mobile hamburger has `hover:bg-accent` but ZERO `focus-visible:*` → no keyboard focus indicator (WCAG 2.4.7). `lightbox-color-pip.tsx` tooltip (`:219`) + copy (`:301`) buttons use `focus-visible:ring-1 focus-visible:ring-white/50` → 1px @ 50% opacity, below WCAG 2.4.11 Focus Appearance (≥2px, ≥3:1). `wide-gamut-hint.tsx:203` `ring-amber-500/40` is 2px-OK but 40% amber-on-amber blends. These are real missed siblings of the cycle-16 focus-visible sweep.
7. **PERF-17-01 — DOWNGRADED (defer).** perf-reviewer cited `data.ts:840` as `getAdminImagesLite`; it is actually `getImagesForFeed` (Atom feed). It orders by `updated_at` BUT has `GROUP BY images.id` for `tag_names` — by perf-reviewer's OWN PERF-17-02 logic, a `(processed, updated_at)` index cannot eliminate the filesort when GROUP BY is on a different column. `getAdminImagesLite` (`:963`) actually orders by `capture_date` (covered by the existing topic index). Index value is marginal here; prior cycles already deferred `(processed, updated_at)` (PERF-15-01/16-03). Defer.
8. **PERF-17-05 — FALSE POSITIVE.** `home-client.tsx:51-57` `handleResize` calls `cancelAnimationFrame(rafId)` at :52 before `requestAnimationFrame` at :53. No accumulation. Cleanup at :63 also cancels. Not a defect.
9. **Doc M-1..M-4 — CONFIRMED.** settings-hash export at `:45-57` (doc says 42-54); topic-rename now re-points 4 stores (doc names 0); upload-TOCTOU not in Race Conditions; `idx_image_views_image_id_viewed_at` (`schema.ts:229`, migration 0010) not in the Database Indexes list.
10. **Architect A1/A2 — CONFIRMED (structural, defer the restructure).** A1: `topics.slug` is referenced by 3 FK children (`topic_aliases`/`images`/`topic_views`) + 1 JSON store (`smart_collections`); none have `ON UPDATE CASCADE`; the delete+insert rename re-points each by hand → the recurring missed-sibling root. Structural fix (FK `onUpdate:'cascade'` + in-place `UPDATE`) is a deliberate migration. A2: `api/search/semantic` + `similar/[id]` enrichment selects sit outside `_PrivacySensitiveKeys`; cycle-16 added a regex denylist fixture (band-aid). Both are real architecture smells; neither is a live bug (security-reviewer: 0 leak). Defer the restructure with the tactical guards already in place.

---

## Cross-agent agreement (higher signal)

- **DBG-17-1 (upload-tracker throw-path claim leak)** — **5 agents** (code-reviewer LOW, critic MAJOR, verifier-implicit, tracer CONFIRMED DEFECT, debugger DBG-17-1). Unanimous headline.
- **GAP-1 (smart_collections remap vacuous gate)** — **2 agents** (verifier, test-engineer).
- **GAP-2 (info-bottom-sheet isAdmin untested)** — **2 agents** (verifier, test-engineer).
- **A1 (topic-slug rename no single source of truth)** — architect (structural framing of the same root tracer/critic/debugger cleared at the instance level).

---

## Positive signals (verified converged)

- Topic-slug rename: ALL 3 FK children + smart_collections `eq`/`in` rules re-pointed in ONE transaction before the old-row delete; mid-rename collision → ER_DUP_ENTRY → rollback (tracer/critic/debugger CLEARED). Only `contains` predicate intentionally not remapped (documented).
- Numeric guards: og-photo-fetch `Number.isFinite(len)` fix correct; every other parseInt/Number→comparison site pre-guarded; GPS clamps ±90/±180, Infinity→NULL (tracer Flow 3 CLEARED).
- Migration 0024_drop_reactions: monotonic `when`, flips journalCovered=false on baselined prod → reconcile runs the guarded drop; post-condition catches silent skips; baselined-not-run on all paths (tracer/debugger/architect CLEARED).
- Color admin-only fields: triple defense (publicSelectFields omits all 10, getImage never fetches them for viewer, every render site gates isAdmin) — no public DOM leak (tracer Flow 5, security-reviewer).
- Security: 0 new findings, 0 npm-audit vulns, every mutating action authZ-gated, SSRF/path-traversal/redirect/header/CSP/CSV/Unicode swept; LR PAT timing-safe; OG SSRF fail-closed (security-reviewer).
- All cycle-16 fixes verified correct (verifier 10/12 fully + 2 gates now patched).

---

## AGENT FAILURES
None. All 11 agents completed and wrote their per-agent file.
