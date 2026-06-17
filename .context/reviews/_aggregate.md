# Aggregate Review — Run-6 Cycle-11 (HEAD `a7de3ebd`)

**Date:** 2026-06-17
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Gate state (verifier, fresh foreground run):** ESLint exit 0; typecheck (app + scripts) exit 0; Vitest **2227 passed / 4 skipped / 0 failed** (236 files passed / 2 skipped); lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0. The 4 skips are the model-weight-gated `clip-offline-load` (×2) + `clip-semantic-integration` (×2) suites (gated by design on `CLIP_MODELS_ROOT` weights — NOT failures).

## Context

CLIP semantic search is LIVE in production. The pre-activation code converged at cycle-7 (0 findings). Activation-surface findings trended **cycle-8: 13 → cycle-9: 5 → cycle-10: 2** (both fixed: AGG-C10-01 nginx LR upload body cap, AGG-C10-02 similar-route test guard). This cycle-11 independently re-verified the cycle-10 fixes AND swept the whole system.

**Verdict: CONVERGED.** 10 of 11 agents report **0 findings** (code-reviewer, perf-reviewer, security-reviewer, critic, verifier-blockers, tracer, architect, debugger, document-specialist, designer). One agent (test-engineer) reports a single **LOW** finding: a missing source-contract pin on a documented (and correct) ranking invariant. No security, correctness, or data-loss finding surfaced. No HIGH or MEDIUM finding surfaced.

**Both cycle-10 fixes independently verified CLOSED at HEAD** by critic, verifier, document-specialist, test-engineer, and tracer:
- **AGG-C10-01** (nginx LR upload body cap): `nginx/default.conf:131` has `location ^~ /api/admin/lr/upload { client_max_body_size 216M; }` carrying the AGG-C10-01 lineage comment. Confirmed the longest-prefix `^~` (22 chars) wins over the generic `^~ /api/admin/` (14 chars, 2M) regardless of source ordering — no `=` exact or regex location matches the path. App enforces 200 MiB/file before any disk write; 216M leaves multipart headroom. CLAUDE.md body-cap doc updated to match.
- **AGG-C10-02** (similar-route test guard): `similar-route.test.ts` mocks `lens_model`/`capture_date` (L116-118), populates them in `imageRows` (L270-271), and asserts `toHaveProperty('lens_model', 'EF 50mm f/1.8')` / `toHaveProperty('capture_date', '2026-01-02 03:04:05')` on the 200-path (L286-293). Cross-checked against the real route (SELECTs both at route.ts:205-206, maps both at 227-228) — a SELECT-drop now fails loudly. Not a tautology.

All NEW HARD GUARDS respected by every agent — no `server-only` re-added to `clip-model.ts`/`@/db`; `semantic_search_mode: 'disabled'` code default intact; no weakening of `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / revision pin / `allowRemoteModels=false` / model_version isolation. The security-reviewer, code-reviewer, critic, and debugger each explicitly noted the deliberate absence of `server-only` and did NOT recommend re-adding it.

**Findings trend across run-6:** cycle-1 ~30 → … → cycle-7 **0** → cycle-8 **13** → cycle-9 **5** → cycle-10 **2** → cycle-11 **1 LOW** (test-only).

---

## Merged findings (deduped; highest severity/confidence preserved; cross-agent agreement noted)

### AGG-C11-01 [LOW] — semantic route `isProd ? dotProduct : cosineSimilarity` similarity-selector has no source-contract pin
**Agent:** test-engineer (TE-C11-01, LOW, conf Low-to-Medium). No other agent flagged it (it is a test-coverage gap, not a runtime defect — debugger and tracer both independently verified the runtime behavior of this exact line is CORRECT).

**Where:** `apps/web/src/app/api/search/semantic/route.ts:271`
```ts
const similarity = isProd ? dotProduct : cosineSimilarity;
```
Documented invariant (comment at lines 267-270): production vectors are L2-normalized (`truncateAndNormalize` in `clip-model.ts`), so `dotProduct === cosine` and is the faster choice; stub vectors (`deterministicEmbedding` in `clip-inference.ts`) are raw `[-1,1]`, NOT normalized, so stub MUST use `cosineSimilarity` or rankings corrupt.

**Problem (test-coverage gap, not a current bug):** No test pins this branch selector. The behavioral tests in `semantic-search-route.test.ts` use mock embeddings (`fill(0.5)`, `fill(0.1)`) whose magnitudes make `dotProduct` and `cosineSimilarity` produce near-identical scores, so the 200-path test passes regardless of which function is selected. A contributor "simplifying" the selector to `const similarity = dotProduct` (unconditional, for perf) would silently corrupt **stub-mode** rankings with zero failing test. Exhaustive grep across all 236 test files confirmed no test references `dotProduct`/`isProd`/`const similarity` against the route source.

**Why LOW (not MEDIUM):** (a) stub mode is the demo/experimental posture; a ranking regression there is not a security or data-integrity issue; (b) the `semanticSearchMode` double-gate (`SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB row, both heal to `disabled`) prevents the stub path from ever reaching production. The current runtime is CORRECT — this is purely a regression guard against a plausible future refactor on a documented invariant.

**Fix:** Add a small source-contract test (consistent with the existing pattern in `search-short-query-guard.test.ts`, `clip-model-contract.test.ts`, `image-queue-embed-wiring.test.ts`) that asserts the route source contains the guarded ternary `const similarity = isProd ? dotProduct : cosineSimilarity` exactly AND does NOT contain `const similarity = dotProduct` unconditionally. No behavioral/runtime change — test-only.

**Repo-policy note:** A genuinely-missing regression guard on a documented invariant — schedulable as a tiny test-only addition. It is also defensibly deferrable (LOW, test-only, current behavior correct, double-gated). Given the orchestrator's strong anti-manufacturing directive AND that this is the established cycle pattern for exactly this kind of source-contract pin (matches the AGG-C9-02 short-query guard precedent), this cycle **schedules it** as a one-test addition — it is in-pattern, root-cause, zero-risk, and closes a real silent-refactor hole on the LIVE feature. **Confidence: H** that the gap is real; severity LOW.

---

## Deferred (existing findings; severity/confidence preserved per deferred-fix rules)

### DEF-C11-01 [LOW] — Search dialog `<Input>` is 32 px tall (`h-8`) — carried forward from DEF-C10-01
**Agent:** designer (cycle-10 FIND-D2, originally MEDIUM/conf-M; aggregator LOW). **Carried forward unchanged.** Not re-raised as a new finding by the cycle-11 designer (verified still in deferred state at HEAD).

**Where:** `apps/web/src/components/search.tsx:374`.

**Status:** Unchanged from plan-364 DEF-C10-01. Single-line full-width text-entry field (large horizontal target); only the vertical extent is 32 px. The repo's own `touch-target-audit.test.ts` deliberately excludes `<Input>` from scope. Not a security/correctness/data-loss finding (those are non-deferrable). Original severity preserved on record (designer MEDIUM/conf-M).

**Exit criterion (re-open + fix `h-8`→`h-11` + extend audit to cover `<Input>` sub-44):** (a) the search field is reworked into a multi-control composite where the input is no longer full-width; OR (b) a real mobile-usability report cites the search field height; OR (c) the repo decides to bring `<Input>` under the touch-target-audit scope (then a hard blocking test failure to fix in the same change). **File+line:** `apps/web/src/components/search.tsx:374`.

---

## Rejected findings (recorded with rationale — NOT scheduled, NOT deferred)

### REJ-C11-01 — `aria-controls` referencing a conditionally-unmounted element (carried from REJ-C10-01)
The cycle-11 designer's report (during its resumed run) contained a stale appended fragment re-stating the cycle-10 FIND-D1 (`aria-controls` on `similar-photos.tsx:116` / `color-details-section.tsx:290`). This was already **rejected in cycle-10 (REJ-C10-01)** after authoritative-source verification: MDN's `aria-controls` page states verbatim that `aria-controls` "only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible." The cycle-8 wiring uses exactly the MDN-endorsed pattern (consistent `aria-controls` + conditional render + correct `aria-expanded`). **No change.** The designer's authoritative cycle-11 verdict is ZERO new findings; the stale fragment was removed from `designer.md` during aggregation. This is NOT counted as a finding.

---

## Documentation-accuracy notes (non-findings — no behavioral defect)

The document-specialist verified all 10 load-bearing doc claims TRUE at HEAD (IMAGE_PIPELINE_VERSION=7, 9 COLOR_IMPACTING_KEYS, 6 advisory locks, login + upload rate limits, the nginx body-cap table incl. the AGG-C10-01 LR cap, the backfill 10-column set on both paths, env var names, CLIP guards, migration runbook hash post-conditions). **Zero load-bearing doc mismatches.** The cycle-10 doc-correction commit `e56babd3` (avif_10bit public-safe, settings-hash line ref, CSS masonry) is accurate. (The harness-injected CLAUDE.md snapshot says "5 COLOR_IMPACTING_KEYS" but HEAD is correct at 9 — that is a stale snapshot artifact, not a code/doc defect.)

The architect noted one optional comment reword (NON-FINDING, no code change): the `image-queue.ts` comment near the embedding-upsert implies stub + production embedding rows coexist per image, but the table is `PRIMARY KEY (image_id)` (one row per image; upsert overwrites to the active model_version, reads filter on it). The actual behavior is correct and produces no wrong output at any scale — the "stub never pollutes production" invariant holds via overwrite-then-filter. Optional prose tidy only; not scheduled.

---

## Per-agent finding counts

| Agent | New findings | Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — ~55 files; embedding dimension invariant airtight (decodeEmbeddingColumn returns null unless exactly 2048 bytes); all 3 HARD GUARDS intact; disproved 4 self-hunted candidates (auth coalesce, ICC strLen-1, gps readSized over-read, tiffStart overflow). |
| perf-reviewer | 0 | APPROVE — semantic scan hard-capped 5000 + composite-index-backed (verified `idx_image_embeddings_model_version_updated` in schema, no filesort); zero N+1; all listings bounded; SW LRU + view-count buffer bounded. |
| security-reviewer | 0 | LOW risk — every attack surface re-read at HEAD; no SQLi/SSRF/path/privesc/PII-leak; 3 lint gates + 72 security fixtures + 180 core security tests pass. (Read-only agent; full report persisted by orchestrator.) |
| critic | 0 | ACCEPT — both cycle-10 fixes verified genuinely closed (nginx precedence + similar-route non-tautology); 5 self-hunted candidates all disproved. |
| verifier | 0 blockers | PASS — full suite 2227 pass / 4 design-gated skips / 0 fail; all gates exit 0; both cycle-10 fixes verified at line level. |
| test-engineer | 1 | TE-C11-01 → **AGG-C11-01** (LOW, test-only). TE-C10-01 confirmed closed. |
| tracer | 0 | All 4 end-to-end paths CLEAN (semantic, similar, upload→processing, backfill); rate-limit rollback on every error early-return; capture_date `mode:'string'` round-trip lossless; SimilarResult wire shape exact match. |
| architect | 0 | SOUND at single-writer scale — CLIP config double-gate fail-closed end-to-end; advisory-lock acquire/release no leak; data.ts PII triple-guard live (tsc exit 0). (1 optional comment reword, non-finding.) |
| debugger | 0 | 15+ runtime-critical paths examined; no crash/throw/hang/corruption/wrong-output; load singleton retry, 3-case decode, clampSemanticTopK boundaries, libheif probe never-rejects, advisory-lock release, view-count flush all correct. |
| document-specialist | 0 | All 10 load-bearing doc claims verified TRUE at HEAD; AGG-C10-01 doc half landed. Zero load-bearing mismatches. |
| designer | 0 | ZERO new findings — full a11y surface (nav, search, lightbox, color pip, photo viewer/nav, tag filter, home, similar-photos, admin) verified clean; i18n key parity exact (ko ICU asymmetry intentional); two cycle-10 priors (REJ-C10-01, DEF-C10-01) NOT re-raised. |

**Net schedulable findings this cycle: 1 (AGG-C11-01 LOW, test-only).**
**Deferred: 1 (DEF-C11-01 LOW, carried from DEF-C10-01).**
**Rejected: 1 (REJ-C11-01, carried from REJ-C10-01).**

## AGENT FAILURES

None (functionally). All 11 agents returned and persisted at HEAD a7de3ebd. Operational notes:
- **security-reviewer** ran under a read-only constraint (Write blocked) and delivered its complete cycle-11 report (0 findings) in its final message; the orchestrator persisted it verbatim to `security-reviewer.md`.
- **tracer** and **designer** went idle mid-investigation on the first pass. The designer's resumed run wrote a fresh cycle-11 report (0 findings) but left a stale cycle-10 fragment appended; the orchestrator removed the fragment during aggregation (the authoritative cycle-11 verdict is 0 findings). The tracer was re-dispatched ONCE and wrote a complete fresh cycle-11 report (4 paths CLEAN). Both are fully accounted for; no agent was silently dropped.
