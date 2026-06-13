# CRITIC — Run-5 Cycle-3 Adversarial Review

**Lane:** Critic (multi-perspective adversarial critique). **Date:** 2026-06-12.
**Scope:** whole current change surface, extra scrutiny on the 21 run-5 cycle-2 commits (`aa5266b5..HEAD`, 54 files).
**Angle:** fix-vs-paper-over, honesty of user-facing claims vs delivered bytes, product coherence, doc-vs-behavior drift introduced by the fixes, half-measures that close one branch and leave siblings open.
**Suppression honored:** plan-315/316/317/322 read first. Items already planned are cross-referenced, not re-reported.

---

## VERDICT: ACCEPT-WITH-RESERVATIONS

The cycle-2 honesty cluster (semantic-search stub posture, `[AUTO]` prefix strip, server-only guard, backfill lock + observability, deterministic batching test) is, on independent code-level verification, **genuinely sound** — not paper-over. The stub embeddings are provably SHA-256-random; the disclaimer is wired; the validator actually rejects `'production'`; the prefix is stripped at BOTH the only two consuming surfaces; the rewritten batching test really does dispatch on SQL content and would now catch the OFFSET/always-break regression the old one missed. I escalated to adversarial depth on the honesty cluster and the test-shaped-to-pass candidates and found no deception.

The one reservation that is NOT already planned: the three touch-target a11y fixes this cycle are real but **unguarded by the regression gate** — the very gate that exists to prevent that defect class — and plan-320's own coverage claim about it was factually wrong, so the gap was closed-as-DONE on a false premise. Everything else is either correct or already tracked.

---

## Pre-commitment predictions vs findings

| Prediction | Outcome |
|---|---|
| Semantic "honest stub" is a paper-over; disclaimer doesn't reach results panel; embeddings still written | PARTLY. Disclaimer reaches the panel footer (always in DOM), validator/heal path verified, embeddings SHA-256-random with preserved `model_version` provenance. The serve-stub-publicly product choice is the only soft spot — already an OPEN QUESTION in AGG-R5C2-01 (planned). NOT a paper-over. |
| `[AUTO]` strip closes copy site, leaves a sibling render surface | DISPROVEN. Only two consumers of `alt_text_suggested` exist (`getConcisePhotoAltText` read path, `applyAltSuggested` copy path); both strip. No leak. |
| Backfill per-image lock has lock-skip semantics that silently drop rows | DISPROVEN. `locked`/`detection-failed` rows keep stale `pipeline_version` → re-picked next run; discriminated-result tally surfaces every skip reason. Real fix. |
| Deterministic batching test still test-shaped-to-pass | DISPROVEN. SQL-content dispatch + bound-cursor assertion + `vi.waitFor` is a correct rewrite. 49/49 green locally. |
| `server-only` test stub defeats the guard it tests | DISPROVEN. Stub only affects vitest (a server env); the Next client build still uses the real throwing package. Guard intact. |
| Touch-target a11y fixes unguarded | CONFIRMED (CRT-R5C3-01). |

---

## Findings

### CRT-R5C3-01 — Touch-target a11y fixes are real but unguarded; the regression gate cannot see `<Link>`, and plan-320 closed the gap on a false premise
- **Severity:** MED · **Confidence:** High · **Status:** confirmed
- **Where:**
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140,172` (`min-h-11` added to two `<Link>` back-links)
  - `apps/web/src/app/[locale]/not-found.tsx:45` (`inline-flex items-center min-h-11`)
  - `apps/web/src/app/[locale]/error.tsx` (a11y heading swap)
  - Gate: `apps/web/src/__tests__/touch-target-audit.test.ts:69-72` (SCAN_ROOTS), `:265+` (FORBIDDEN regex set)
  - Plan provenance: `plan/plan-320-run5-cycle2-medium.md:31` and `:67`
- **Problem:** All FORBIDDEN regex patterns anchor on `<Button>`, `<button>`, `<Badge asChild>`, or native `<select>`. None match `<Link>` or `<a>`. So even though `g/[key]/page.tsx` IS walked (`publicDir` = `app/[locale]/(public)` is in SCAN_ROOTS), its back-link can never trip a FORBIDDEN pattern — the `min-h-11` there is invisible to the gate. Worse, `not-found.tsx` and `error.tsx` live at `app/[locale]/`, one level ABOVE `(public)`, so they are not walked at all. All three of this cycle's touch-target fixes are therefore unprotected against silent regression — the exact failure mode (sub-44 px interactive element shipping unseen) that the audit exists to prevent.
  Compounding: plan-320 Item 6 (line 31) asserted "`app/[locale]/(public)` is NOT scanned (only components/ + admin) — note this gap in the test file comment or extend scanning if cheap." That premise is **factually wrong** (publicDir IS scanned), so the implementer correctly didn't add the false note — but in doing so also never addressed the REAL gap (element-type coverage + the truly-unscanned `app/[locale]/` root). Item 6 is marked DONE (line 67) on a mistaken coverage model.
- **Failure scenario:** A future refactor of the shared-group header or the 404 recovery link drops `min-h-11` (e.g. a Tailwind class reshuffle). `npm test` stays green; the touch-target gate reports 0 violations; a 20 px tap target ships to production on the public shared-gallery and 404 surfaces. This is identical to the R4C15/R4C16 incidents that drove `<Badge>` and `<select>` into FORBIDDEN in the first place.
- **Suggested fix:** (a) Add a FORBIDDEN pattern for `<Link>`/`<a>` carrying a sub-44 sizing class WITHOUT a `min-h-1[12]`/`h-1[12]` override (mirror the `<button>` patterns); the three fixed links pass it. (b) Add `app/[locale]` (non-recursively, or with a depth guard so it does not double-walk `(public)`/`admin`) to SCAN_ROOTS, or add `not-found.tsx`/`error.tsx` explicitly, so root-level route files are covered. (c) Fix or delete the stale coverage claim in plan-320 Item 6 so the next cycle does not inherit the wrong scan model.
- **Not in suppression:** plan-322 does not list it; plan-321 only carries the WCAG-2.2 wording note (AGG-R5C2-48), which is a different sub-task and DID land. This element-type/root-scan gap is unowned.

### CRT-R5C3-02 — Checkout unknown-IP fix silently drops ALL double-click protection for misconfigured-proxy deployments (documented trade-off, narrow honesty note)
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/app/api/checkout/[imageId]/route.ts:182-185`
- **Problem:** The fix is correct (omitting the idempotency key prevents distinct unknown-IP buyers from colliding on one Stripe session — the TRC-R5C1-16 defect). But the cure removes idempotency ENTIRELY for unknown-IP callers, so a single buyer's genuine double-click / network retry now creates TWO pending Stripe sessions that sit unpaid until ~24 h expiry — the precise false-positive payment-monitoring-alert condition the original idempotency key (line 162-171 comment) was added to suppress. The in-code comment frames this only as "Stripe-side deduplication is lost for misconfigured-proxy deployments," underselling that double-click protection is also lost for every legitimate single buyer on such a deployment.
- **Failure scenario:** Deployment without `TRUST_PROXY`. One impatient buyer double-clicks Buy → two pending Checkout sessions → payment-monitoring alert fires on the second unpaid session 24 h later. Detection: visible in Stripe dashboard / monitoring noise; no data loss, no double-charge (only one can be paid). Self-correcting at expiry.
- **Realist check:** This is bounded to misconfigured deployments only (correct prod config sets `TRUST_PROXY=true`, restoring per-IP keys), is self-healing at expiry, and causes alert-noise not a charge fault. Correctly LOW. The honest move is a one-line comment amendment, not a code change.
- **Suggested fix:** Amend the comment to state plainly that single-buyer double-click dedup is also forfeited under unknown-IP, and (optional) append a `crypto.randomUUID()` only on retry rather than dropping the key wholesale — but the current omission is an acceptable trade-off given correct-config is the documented expectation. Comment-only.

---

## What's Missing (gaps the fixes did not cover)

- **Touch-target gate element coverage** (CRT-R5C3-01) — the gate still cannot see anchor-based interactive elements anywhere in the tree, nor any interactive element in `app/[locale]/*.tsx` root files. This cycle ADDED three anchor-based touch-target fixes without extending the gate, net-widening the unguarded surface.
- **No visitor-facing disclaimer on the semantic RESULTS rows themselves** — the experimental hint lives in the footer panel (`search.tsx:444`), always in the DOM but visually below the results list; on a long result set the disclaimer can scroll out of view while random-ranked cards are on screen. This is inside the AGG-R5C2-01 "serve-stub-publicly vs admin-only" open question (planned), so not re-reported as a new finding — flagged here only as the residual edge of that planned item.

## Ambiguity Risks

- None material. The cycle-2 comments are unusually precise (the backfill non-snapshot invariants at `admin-backfill-runner.ts:240-251` and the embedding stub-provenance contract at `image-queue.ts:406-423` are model-grade documentation, not hand-waving).

## Multi-Perspective Notes

- **Executor:** Every cycle-2 fix is reproducible from its comment + test. The batching test's `inspectSql` helper depends on drizzle's internal `queryChunks`/`StringChunk` shape — a drizzle-orm major bump could break the test's SQL classifier (test-only fragility, not production). Worth a comment pin to the drizzle version, but not a finding.
- **Stakeholder:** The honesty posture genuinely solves the stated problem — a visitor is told the semantic results are experimental; an admin sees "Stub (testing only)"; stub embeddings carry distinguishable provenance. Product coherence is intact.
- **Skeptic:** Strongest argument against the whole cycle — "serving random-ranked search results to the public at all is dishonest regardless of a disclaimer." That is the real open product question, and the cycle correctly DEFERRED the serve-stub-publicly-vs-admin-only decision (AGG-R5C2-01) rather than pretending the disclaimer settles it. Honest deferral, not evasion.

## Verdict Justification

ACCEPT-WITH-RESERVATIONS. Adversarial-mode escalation was applied to the honesty cluster and the two test-shaped-to-pass candidates (batching test, server-only stub); both survived scrutiny as genuine fixes. The only un-planned defect is CRT-R5C3-01 (MED) — a half-measure where the symptom was fixed but the regression gate was not extended, compounded by a false coverage premise in plan-320. CRT-R5C3-02 is a LOW comment-honesty note on a correct, documented trade-off. No CRITICAL/HIGH, no data-loss, no security regression. To upgrade to ACCEPT: extend the touch-target FORBIDDEN set to anchors + add root-level route scanning, and correct plan-320 Item 6's stale claim.

Realist-check recalibrations: CRT-R5C3-02 held at LOW (bounded to misconfigured deployments, self-healing, alert-noise only). CRT-R5C3-01 held at MED (real regression-prevention gap on public surfaces, but no current sub-44 element ships — it is a latent gate hole, not a live defect).

## Open Questions (unscored)

- Should the semantic search toggle be admin-only rather than public while it serves stub results? (= AGG-R5C2-01 open product question, planned — listed here only for continuity.)
- Does the drizzle `queryChunks` private-API dependency in `admin-backfill-runner-batching.test.ts:198-219` warrant a version pin comment? (test-resilience, not a defect.)

## Perspectives covered
Honesty-of-claims (semantic stub, embeddings, prefix), fix-vs-paper-over (5 cycle-2 commits traced to code), sibling-surface sweep (`alt_text_suggested` consumers, `idempotencyKey` uses, `getClientIp` uses), test-shaped-to-pass (batching test, server-only stub, bulk-update test), product coherence, doc-vs-behavior drift (analytics index notes, gallery-config union, route docstring), regression-gate adequacy (touch-target audit), Executor/Stakeholder/Skeptic plan perspectives.
