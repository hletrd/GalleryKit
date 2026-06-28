# Run-21 Cycle-21 — Aggregated Review

**Date:** 2026-06-29
**HEAD:** 993ed471 (cycle-20 T1–T7 fixes + SW stamp landed)
**Agents:** 11/11 completed (code-reviewer, security-reviewer [opus], perf-reviewer [via general-purpose], critic [opus], architect [opus], verifier, test-engineer, tracer, debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates (verifier-confirmed + own baseline run):** eslint exit 0, tsc exit 0, vitest **2168 pass / 4 skip** (238 files), lint:api-auth / lint:action-origin (41 exports) / lint:public-route-rate-limit all exit 0. `npm audit --omit=dev` 0 vulns. Test count +13 vs cycle-20 (2155 → 2168).

---

## Convergence summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | Security-reviewer (opus): 0 confirmed-exploitable across full OWASP sweep. |
| HIGH | 0 | None runtime. The designer's 13 "HIGH" focus-visible findings are a11y-cosmetic (critic verified none set `outline-none`, so UA-default ring still shows → consistency gap, NOT a WCAG hard-failure). |
| MEDIUM | 2 | **(1) Focus-visible scanner exit criterion DUE (2-agent: designer D21 + critic CRIT21-01)** — committed-for-cycle-21 deadline reached; 13 fresh `<Link>`/`<a>`/raw-`<button>` siblings lack `focus-visible:ring`. **(2) TEST21-01** — the cycle-20 `IMAGE_MAX_INPUT_PIXELS[_TOPIC]` env-parse fix shipped with NO regression test (`MAX_INPUT_PIXELS_TOPIC` is exported + directly testable). |
| LOW (actionable) | 5 | **CRIT21-02 / DOC** SEMANTIC_SCAN_LIMIT + SEMANTIC_TOP_K_MAX documented as env-tunable but HARDCODED `export const` (no `process.env` read) — confirmed mismatch. **DBG21-01** topics.ts:108/211 `parseInt(orderStr,10)` on the FormData `order` field mis-parses `'1e3'`→1 (env-parse class sibling, user-input variant). **C21-RVW-01** data.ts:163-170 post-flush eviction drops buffer entries without clearing `viewCountRetryCount` (the missed sibling of the R15C15 CR-15 fix at :146). **Doc gaps** DOC21-M1/G1/G2/G3. |
| STRUCTURAL/DEFER | ~9 | A1 topics.slug cascade (exit UNMET, best-fenced); A3 upload single-settle (exit UNMET — 0 new awaits in span); A4 restore-maintenance scale-out fence (exit UNMET); A5 @/lib/storage dead-module (quarantine CI guard intact); A6/N2 data.ts cohesion (architect CORRECTION: N2 is type-only `import type`, cohesion-only NOT layering — ARCH21-01); N1 PrivacySensitiveKeys hand-union (E4, exit UNMET); PERF-C21-01 similar-route sync scoring (scale-gated); PERF-C21-02 home-client O(N²) (informational); DBG21-02 hypothetical FS O_TRUNC; TRACE21-05-LOW requireSameOriginAdmin lint doesn't gate isAdmin(); C21-RVW-02 proxy dead condition; TEST21-02 IMAGE_CLEANUP_CONCURRENCY untested. |
| DOC | 17 MATCH / 1 MISMATCH / 3 GAP | document-specialist: all 5 cycle-20 GAPs confirmed closed. New: DOC21-M1 (lock scope note), DOC21-G1/G2 (topic-route-lock coverage + admin-only labels), DOC21-G3 (SHARP_CONCURRENCY formula). |
| FALSE-POSITIVE / BENIGN | — | security XFF index concern FALSE-POSITIVE-CHECKED against shipped nginx (`X-Forwarded-For $remote_addr`). CRIT21-04 Math.floor asymmetry benign. |

**Verdict:** Mature, exceptionally hardened. Zero new live CRIT/HIGH; security-reviewer found 0 exploitable across the full OWASP sweep and verified every cycle-20 fix opens no new hole. The headline signal this cycle: **the focus-visible scanner is at its committed-for-cycle-21 deadline** (designer + critic, 2-agent) — the manual sweep has surfaced 3–13 fresh siblings for 5 consecutive cycles and is not converging; build the scanner now. Secondary: a small cluster of cheap, real correctness/consistency fixes (topics.ts order parseInt, viewCountRetryCount orphan, SEMANTIC limit env-wiring, the missing IMAGE_MAX_INPUT_PIXELS test) plus doc-gap closures.

---

## Cross-agent agreement (higher signal)

- **Focus-visible scanner DUE + 13 concrete siblings** — **2 agents** (designer D21-01..13 + critic CRIT21-01). Cycle-20 plan explicitly COMMITTED the broad scanner for cycle 21 (criterion met). Designer enumerated 13 fresh gaps (footer, s/[key], year/[year], analytics-client, not-found, public+admin error.tsx, on-this-day-widget, home-client clear-filter, topic-empty-state, admin-header logo, nav-client logo). Critic's realist note: none set `outline-none` so the UA default ring remains → cosmetic consistency, not a WCAG hard failure — but the repo's convention is the explicit `focus-visible:ring` token and the durable fix is the scanner. Critic also flagged the 2 false-positive shapes the scanner must handle (`group-focus-visible:` on a child; UA-default-acceptable). **Implement: fix all 13 + build the conservative scanner seeded to 0.**
- **SEMANTIC_SCAN_LIMIT / SEMANTIC_TOP_K_MAX doc-code mismatch** — critic CRIT21-02 (+ confirmed by my own grep): CLAUDE.md "Runtime limits" presents both as env-tunable (`SEMANTIC_SCAN_LIMIT` default 2000, `SEMANTIC_TOP_K_MAX` default 50) but `clip-embeddings.ts:17-18` hardcodes them as `export const` with NO `process.env` read. The doc presents them as operational levers — wire the env read (the documentation-intent fix) rather than weaken the doc.
- **env-parse sweep COMPLETE for env vars** — **3 agents** (critic, verifier, debugger): every `parseInt(process.env…)` is now `Number()`. Debugger's residual finding DBG21-01 is a DIFFERENT domain (a FormData user-input field, `topics.ts` `order`), not an env var — still a real `'1e3'`→1 mis-parse worth the same one-line fix.

---

## Lead triage (implement vs defer this cycle)

### IMPLEMENT (actionable now)
1. **Focus-visible: fix 13 concrete siblings (D21-01..13) + build the conservative scanner** (2-agent, MEDIUM/committed-deadline). Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [rounded]` to each. Build `__tests__/focus-visible-links-scan.test.ts`: walk `components/` + `app/[locale]/`, flag `<Link`/`<a `/raw `<button` openings whose className carries an interactive signal (`hover:`) but lacks `focus-visible:ring` and an exempt marker; seed KNOWN_VIOLATIONS to 0 after the fixes. Handle critic's false-positive shapes. Mirror touch-target-audit's multi-line normalization.
2. **topics.ts order parseInt (DBG21-01, LOW correctness)** — `:108`/`:211` `parseInt(orderStr,10)`→`Number(orderStr)` + guard `Number.isNaN`→`!Number.isFinite` (also catches `Infinity`). Add a focused test.
3. **viewCountRetryCount orphan on post-flush eviction (C21-RVW-01, LOW/High)** — add `viewCountRetryCount.delete(oldestKey)` in the data.ts:163-170 eviction loop to match the line-146 R15C15 CR-15 sibling. Best-effort analytics, but the comment already CLAIMS "matching viewCountRetryCount eviction" — honor it. Add/extend a test.
4. **SEMANTIC_SCAN_LIMIT/TOP_K env wiring (CRIT21-02)** — read `process.env.SEMANTIC_SCAN_LIMIT` / `SEMANTIC_TOP_K_MAX` via `Number()` + finite/positive guard, fall back to 2000/50. Add a test.
5. **IMAGE_MAX_INPUT_PIXELS_TOPIC regression test (TEST21-01, MEDIUM-gap)** — cover the exported `MAX_INPUT_PIXELS_TOPIC` with scientific-notation + NaN/empty/negative cases (mirror upload-limits-env.test.ts via `vi.resetModules()`).
6. **Doc-gap closures (document-specialist)** — DOC21-M1 (advisory-lock scope note: `gallerykit_topic_route_segments` covers create/update/createTopicAlias, not just renames), DOC21-G2 (Race-Condition-Protections bullet for topic create+alias lock), DOC21-G1 (label color_space/icc_profile_name/bit_depth rows admin-only), DOC21-G3 (document SHARP_CONCURRENCY default formula).

### DEFER (structural / scale-gated / cosmetic — see cycle-21-deferred.md)
A1 topics.slug (exit UNMET, best-fenced); A3 single-settle (0 new awaits — exit UNMET); A4 restore-maintenance (exit UNMET); A5 storage dead-module (quarantine guard intact); A6/N2 data.ts cohesion (ARCH21-01: type-only, cohesion-only); N1/E4 privacy union (additive-bidirectional only, exit UNMET); PERF-C21-01 similar-route sync scoring (scale-gated, escalate near 2000 corpus); PERF-C21-02 home-client O(N²) (informational); DBG21-02 hypothetical FS fault; TRACE21-05-LOW requireSameOriginAdmin↔isAdmin (runtime-crashes not bypass); C21-RVW-02 proxy.ts dead condition (LOW/Low cosmetic); TEST21-02 IMAGE_CLEANUP_CONCURRENCY (LOW, `||5` fallback); VER21-01 D20-02 ring-white-vs-ring-ring (functionally correct, plan-note stale — annotate only).

---

## Per-agent headline (provenance: per-agent files are fresh cycle-21)

- **code-reviewer** — 0 CRIT/HIGH/MED, 2 LOW. C21-RVW-01 (viewCountRetryCount orphan, actionable), C21-RVW-02 (proxy dead condition, defer). APPROVE.
- **security-reviewer [opus]** — 0 CRIT/HIGH/MED/LOW-new, 1 INFO (nginx edge throttles the carried token LOW). All cycle-20 fixes verified no-new-hole. `npm audit` 0 vulns.
- **perf-reviewer** — PERF-C20-01 verified fixed (3500ms < 10s budget). 2 new LOW, both scale-gated/informational; all 7 prior deferrals correctly unchanged.
- **critic [opus]** — ACCEPT-WITH-RESERVATIONS. CRIT21-01 (scanner DUE + ~14 siblings, realist-downgraded to cosmetic), CRIT21-02 (SEMANTIC limit doc-mismatch, actionable), CRIT21-03 (A3 correctly deferred — adopt hard-trigger), CRIT21-04 (benign). T1–T7 all verified complete/correct.
- **architect [opus]** — byte-stable since cycle-20; all 5 named exit criteria UNMET. ARCH21-01 CORRECTION: N2 is `import type` (runtime-erased) → cohesion-only, downgrade priority. A1 is the best-fenced deferred item.
- **verifier** — PASS, 0 blockers. All 6 gates green; T1–T7 + 7 CLAUDE.md behavioral claims all MATCH with file:line evidence. VER21-01 plan-note staleness only.
- **test-engineer** — HEALTHY. TEST21-01 (MEDIUM: missing IMAGE_MAX_INPUT_PIXELS test), TEST21-02 (LOW: IMAGE_CLEANUP_CONCURRENCY). cycle-20 added tests all verified non-vacuous.
- **tracer** — 6 flows traced; 0 CRIT/HIGH/MED. TRACE21-05-LOW (requireSameOriginAdmin lint doesn't gate isAdmin — runtime crash not bypass). All cycle-20 IMPLEMENT items CONFIRMED-APPLIED.
- **debugger** — sweep COMPLETE. DBG21-01 (LOW: topics.ts order parseInt — actionable), DBG21-02 (VERY LOW hypothetical FS fault — defer).
- **document-specialist** — 17 MATCH / 1 MISMATCH / 3 GAP. All cycle-20 GAPs closed. DOC21-M1/G1/G2/G3 cheap doc fixes.
- **designer** — 13 fresh focus-visible gaps (11 HIGH a11y-cosmetic, 2 MED) + MAJOR-2 scanner DUE. i18n parity, contrast, ARIA, reduced-motion, touch targets all PASS.

## AGENT FAILURES
None. All 11 agents completed; each per-agent file is fresh (cycle-21). The cycle-20 per-agent files were archived to `.context/reviews/archive/cycle-20/` for provenance before this run overwrote them.
