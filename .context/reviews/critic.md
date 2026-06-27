# Cycle-18 Critic — Adversarial Critique of the Cycle-17 Change Surface & Codebase Direction

**HEAD:** a9702716. Mode: started THOROUGH, did not escalate to ADVERSARIAL — cycle-17 fixes are individually correct; the genuine issues are architectural/process, not new runtime defects. Evidence: all 6 cycle-17 test files pass (34/34, vitest 4.1.9).

## Pre-commitment predictions vs found
- New missed-sibling inside DBG-17-1 fix → **refuted at instance** (the only other post-claim await, images.ts:512 `deleteOriginalUploadFile`, swallows errors so can't leak) but the structural root is real (MAJOR-1).
- Privacy enrichment selects bypass compile-guard → **confirmed + sharper** (the band-aid PII_COLUMNS denylist is itself unsynchronized; CLAUDE.md checklist omits it) (MAJOR-3).
- Comment-asserted invariants the code doesn't hold → **confirmed** (images.ts:264-265 INVARIANT comment violated by :512) (MINOR-1).
- Vacuous fixtures → **partially** (GAP-1 behavioral; GAP-2/GAP-3 non-vacuous but source-regex only) (MINOR-2).

## MAJOR Findings

### MAJOR-1 — Upload-tracker claim has no single settle point (architectural, High)
Claim once (images.ts:226-228), reconciled at SIX hand-placed settle sites (:244,:249,:273,:277,:533,:555). DBG-17-1 was a missed sibling *inside* the CR-16-01 fix. The cycle-17 remediation adds a 7th settle + an unenforced INVARIANT comment (:264-265). The comment is process, not mechanism. A `settled` flag set true at each intentional settle + a settling `finally` (:581, extend `if(claimed && !settled) settle(...,0,0)`) makes a leak structurally impossible. Per-incident impact LOW (self-healing ≤1h window, not attacker-triggerable); value = eliminate a recurring CLASS. **Direction:** replace comment + 7 sites with settled-flag + settling finally (~10 lines).

### MAJOR-2 — `topics.slug` is a mutable natural key used as PK; rename fan-out unbounded, already caused data loss (architectural, High)
schema.ts:5 slug is PK. 3 FK children (topic_aliases, images, topic_views) — none with ON UPDATE CASCADE — + smart_collections.query_json JSON store. Rename = delete-old + insert-new, manual re-point of every child. Already produced: real data loss (097c472b DBG-16-01 topic_views CASCADE wipe), GAP-1 vacuous test, the still-un-remapped `contains` predicate. Data-loss class → do not downgrade. **Direction:** ship cascade interim (onUpdate:'cascade' on 3 FKs + in-place UPDATE) next cycle; surrogate auto-increment PK is the root. Stop deferring the whole thing.

### MAJOR-3 — A2 search-route privacy guard (PII_COLUMNS) unsynchronized + CLAUDE.md checklist omits it (privacy, Medium-High)
Two hand-maintained PII lists: `privacy-fields.test.ts` SENSITIVE_KEYS (rigorously tied via symmetric guard :88-94 — the GOOD mechanism) and `search-route-privacy.test.ts` PII_COLUMNS (:23-43, free-floating denylist, no tie). They agree today except `processed` (intentional). CLAUDE.md migration checklist step 5 names 3 update sites and OMITS PII_COLUMNS (already stale w.r.t. cycle-16's own addition). Failure scenario: add admin-only column per checklist (3 sites) → SENSITIVE_KEYS passes, PII_COLUMNS untouched → later wire into search card without isAdmin → grep test passes → admin-only field leaks to anonymous search. **Direction:** (1) `PII_COLUMNS = SENSITIVE_KEYS.filter(k=>k!=='processed')`; (2) add PII_COLUMNS to the checklist; real fix = shared compile-guarded `publicEnrichmentFields` projection.

## MINOR Findings
- **MINOR-1** — INVARIANT comment images.ts:264-265 overstates: :512 `await deleteOriginalUploadFile` is a post-claim await that doesn't settle; safe only because that helper never rejects (a second unstated invariant). MAJOR-1 finally-flag makes the comment unnecessary.
- **MINOR-2** — GAP-2/GAP-3 are source-regex (textual presence), not behavioral; break on benign refactors, miss semantically-equivalent regressions. GAP-1 is the behavioral model. Acceptable belt-and-braces.
- **MINOR-3 (environmental)** — stale `.next/standalone` test duplicates poison a root-cwd `npx vitest run` (9 false failures); documented `npm test --workspace=apps/web` is clean (34/34). Worth a runbook line.

## Verified-correct cycle-17 work
DBG-17-1 fix complete for realistic throw surface; PERF-17-04 complete (no third config-read sibling); a11y rings deliberate per-background contrast; GAP-1 genuinely behavioral; privacy-fields symmetric guard is drift-IMPOSSIBLE (the template MAJOR-3 should follow).

## Direction critique
Hardening leans on three "remember to keep in sync" mechanisms: invariant comments, source-scan fixtures, parallel hand-maintained lists. All only DETECT drift if a human wrote the right entry — the substrate that manufactures "fix one sibling, miss the next." The repo's own privacy-fields symmetric guard proves the better path: DERIVE the invariant so drift is structurally impossible. The three MAJORs are all band-aid→derivation conversions.

**Verdict: ACCEPT-WITH-RESERVATIONS.** Fixes individually correct + green; reservations are 3 architectural/process roots (MAJOR-1/2/3) that point-patches treat symptomatically.
