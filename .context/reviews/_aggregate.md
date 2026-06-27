# Run-18 Cycle-18 Convergence — Aggregated Review

**Date:** 2026-06-27
**HEAD:** a9702716 (cycle-17 fixes landed)
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates (verifier-confirmed):** eslint clean (exit 0), tsc clean (exit 0), vitest 2119 pass / 4 skip, 3 security lint gates OK. (test-engineer added +8 focus-visible tests → 2127 during its pass.)

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities. `npm audit --omit=dev` 0 vulns (security-reviewer re-ran). |
| HIGH | 0 | None runtime. |
| MEDIUM | 0 | No new live runtime defects. All cycle-17 fixes verified correct. |
| LOW (actionable) | ~6 | **D18-01/CR-18-1 (2-agent HEADLINE)** nav-client theme+locale buttons missing focus-visible rings (sibling of cycle-17 hamburger fix); wide-gamut-hint `focus:`→`focus-visible:outline-none`; smart-collection remap silent-skip log; D18-02 hardcoded blue outline vs ring-ring token; D18-06 masonry hover not reduced-motion-gated; perf LOW items (MQL allocs, histogram worker). |
| STRUCTURAL | 3 | **MAJOR-1/A4** upload-tracker claim has no single settle point (5+ hand-placed settles + comment); **MAJOR-3/A2/SEC-LOW-1** search-route enrichment selects outside compile-guard + duplicated across 2 routes + PII_COLUMNS denylist hand-maintained + CLAUDE.md checklist omits it; **MAJOR-2/A1** topics.slug mutable-natural-key rename fan-out, no ON UPDATE CASCADE, data-loss history. |
| DOC | 6 | M-A settings-hash.ts:41-53→45-57; M-B process-image.ts:1131-1135 (hard-link dedup, WI-14 is ~1157-1167); M-C color-detection.ts:99-107→ProPhoto at 108; M-D NEXT_UPLOAD_BODY_MAX_BYTES 279620608→278921216; M-E image_views(image_id,viewed_at) index missing from Database Indexes; SEC-LOW-2 LR token header X-Admin-Token→X-GalleryKit-Token + gk_base64url(32) not 32-hex. |
| FALSE-POSITIVE | 1 | CR-18 images.ts:512 `deleteOriginalUploadFile` "unguarded await leaks claim" — REFUTED by 4 agents (critic/tracer/verifier/debugger): the helper swallows both unlinks (`.catch(()=>{})`, upload-paths.ts:75-81), so it cannot throw. Latent-only (if helper changes). |

**Verdict:** Mature, well-hardened. ZERO new live runtime defects this cycle. All cycle-17 fixes verified individually correct (verifier 6/6 gates green + 4 fixes confirmed + 3 test gates non-vacuous). The signal this cycle is: (1) ONE clear a11y missed-sibling (nav theme/locale focus rings, 2-agent), (2) THREE recurring STRUCTURAL roots the point-patches keep treating symptomatically (upload-tracker single-settle, search-route shared guarded select, topic-slug cascade), and (3) a batch of doc-drift line refs.

---

## Lead triage (what to implement vs defer this cycle)

### IMPLEMENT (high-value, low-risk, actionable now)
1. **CR-18-1 / D18-01 (2-agent, HIGH signal) — nav-client.tsx theme toggle (155-165) + locale switch (166-172) focus-visible rings.** Direct sibling of the cycle-17 hamburger fix. Clear WCAG 2.4.7 gap, trivially safe. Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. + extend the focus-visible test fixture.
2. **A2 / MAJOR-3 / SEC-LOW-1 (4-agent) — shared compile-guarded `searchEnrichmentSelectFields`.** Extract the enrichment column object from `data.ts` with an `Extract<keyof, _PrivacySensitiveKeys>` compile guard; import in both `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts`. Collapses 3 near-copies to 1, deletes the hand-maintained denylist drift class. No live leak today → drift-prevention. Low-risk (column set unchanged). Also derive PII_COLUMNS from SENSITIVE_KEYS and update CLAUDE.md checklist.
3. **A1 tactical net (architect, recommended 2 cycles running) — schema-derived FK registry test** for topics.slug. Assert the FK set referencing topics.slug == the set updateTopic re-points. Lands the cheap net; DEFER the cascade migration restructure.
4. **Doc M-A..M-E + SEC-LOW-2** — all doc-only, trivial CLAUDE.md edits.
5. **Polish** — wide-gamut-hint.tsx:203 `focus:`→`focus-visible:outline-none`; smart-collection remap debug log (topics.ts:309-316).

### EVALUATE-THEN-IMPLEMENT-OR-DEFER (correctness-sensitive)
6. **MAJOR-1 / A4 — upload-tracker single settling finally.** Architecturally valuable (kills the recurring leak class) BUT subtle: a blanket `finally{settle(0,0)}` is WRONG for any throw AFTER files are committed (under-count). In practice the per-file loop is fully inner-try/catch'd so no committed-then-throw path exists, making 0/0 safe today — but the refactor must preserve that invariant. If a clean, correct implementation is achievable, implement; else defer with the verifier-suggested cross-reference comment on `deleteOriginalUploadFile`. Instance severity LOW (self-healing, not attacker-triggerable).

### DEFER (structural migration / scale-gated / acceptable)
- **MAJOR-2 / A1 restructure** — topics.slug surrogate-PK + onUpdate:cascade migration. Deliberate migration; defer with exit criterion (land the tactical registry test now instead).
- **PERF-18-01** getTopics N correlated MAX(updated_at) subqueries (MEDIUM, scale-gated, already R18-M1 in code, ISR-cached). **PERF-18-02** COUNT(*) OVER() (MEDIUM, scale-gated <2000 imgs). **PERF-18-03** getTopicBySlug 2 round trips (LOW). **PERF-18-05/06/07** MQL allocs / histogram worker recreate (LOW micro). All defer.
- **D18-02** blue-outline→ring-ring token unification (repo-wide consistency, not a hard WCAG fail in modes used). **D18-06** masonry hover reduced-motion (AAA). Defer/optional.
- **CR-18 images.ts:512** — FALSE POSITIVE (refuted), no action (or fold into MAJOR-1 cross-ref comment).

---

## Cross-agent agreement (higher signal)
- **nav-client theme/locale focus-visible rings missing** — **2 agents** (code-reviewer CR-18-1 conf-HIGH, designer D18-01 HIGH). Clear actionable WCAG sibling.
- **Search-route enrichment selects outside privacy compile-guard (A2)** — **4 agents** (architect A2, critic MAJOR-3, security LOW-1, tracer Flow-4 structural smell). No live leak; unanimous structural concern.
- **Upload-tracker single-settle-point (A4/MAJOR-1)** — **2 agents** (critic MAJOR-1, architect A4). Recurring-root framing.
- **topics.slug rename fan-out (A1/MAJOR-2)** — **2 agents** (architect A1, critic MAJOR-2). Data-loss history; defer restructure, land tactical net.
- **images.ts:512 deleteOriginalUploadFile** — **4 agents REFUTED** as live bug (critic/tracer/verifier/debugger). FALSE POSITIVE.

## Positive signals (verified converged)
- All 4 cycle-17 fixes verified correct (DBG-17-1 topic-SELECT settle, PERF-17-04 semantic snapshot, 4 focus rings, 3 non-vacuous test gates) — verifier 6/6 gates + tracer 4/4 flows CLEARED + debugger 0 new bugs.
- Privacy guard triple defense intact; security 0 findings, 0 npm-audit vulns.
- Topic-slug rename re-points all 4 stores in one transaction before delete (tracer Flow-2 CLEARED at instance level).
- `deleteOriginalUploadFile` swallow-errors contract makes the only remaining post-claim await safe.

## AGENT FAILURES
None. All 11 agents completed and their per-agent file is fresh (cycle-18).
