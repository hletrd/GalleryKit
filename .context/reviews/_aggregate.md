# Run-19 Cycle-19 — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 5c559a0f (cycle-18 fixes landed)
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates (verifier-confirmed):** eslint exit 0, tsc exit 0, vitest 2134 pass / 4 skip (234 files), lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0.

---

## Convergence summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities. `npm audit --omit=dev` 0 vulns. |
| HIGH | 0 | None runtime. |
| MEDIUM | ~5 | Search-enrichment compile-guard gap (A2/MAJOR-1, **3-agent**); focus-visible enforcement-harness gap (MAJOR-2 + 4 designer findings); OG sequential 60s worst-case (CQ19-01); upload single-settle restructure (A3); getImagesForSmartCollection COUNT(*) OVER() per page (PERF, scale). |
| LOW (actionable) | ~14 | MINOR-1 search-enrichment failure swallowed no-log (**critic, HIGH**); F1 view-retention parseInt('1e3')→1-day silent (debugger); F2 GPS-strip oversized-box bypass (debugger, **privacy**); D19-01 lightbox focus-ring on invisible hitbox (designer HIGH); D19-07 skip-link focus:→focus-visible: (designer HIGH); D19-08 blue-outline→ring-ring token ×3 (designer); D19-09 upload-dropzone focus:→focus-visible:; D19-05 text-[10px] badges; MINOR-2 windowless settle; CQ19-02 BoundedMap entries() live-ref; CQ19-03 useCallback; CQ19-04 cross-sibling import; SEC-19-01 IPv6 /64; test FINDING-1 rollbackOgAttempt untested. |
| STRUCTURAL/DEFER | 6 | A1 topics.slug cascade migration; A4 restore-maintenance flag scale-out fence; A5 storage dead-module whitelist/delete; A6 view-buffer extraction; D19-04 dl/dt/dd EXIF semantics; test FINDING-2 lr-upload functional harness. |
| DOC | 0 | document-specialist: all 29 checked items MATCH. CLAUDE.md accurate. |
| FALSE-POSITIVE | 1 | deleteOriginalUploadFile "unguarded await leaks claim" — all agents correctly skipped (helper swallows both unlinks). |

**Verdict:** Mature, well-hardened. Zero new live runtime defects. The signal this cycle: (1) THREE cheap correctness/privacy/observability fixes (search-enrichment no-log, view-retention parseInt, GPS-strip oversized-box bypass), (2) a cluster of concrete a11y focus-visible misses (designer, the recurring "miss the next sibling" theme), (3) the top structural item (A2 search-enrichment compile-guard extract, 3-agent agreement, safe + deletes a net-test), and (4) the recurring structural roots (A3 quota single-settle, MAJOR-2 focus scanner, A1 slug cascade) that prior cycles keep netting symptomatically.

---

## Cross-agent agreement (higher signal)
- **Search-route enrichment selects outside the privacy compile-guard, duplicated ×2 (A2/MAJOR-1)** — **3 agents** (architect A2, critic MAJOR-1, tracer F2-STRUCT-01). Security drift now monitored by a denylist test but NOT structurally closed. Unanimous: extract one compile-guarded `searchEnrichmentSelectFields` const, import in both routes, retire the denylist. Low-risk (column set unchanged).
- **Search enrichment failure swallowed → empty 200 no log (MINOR-1)** — critic HIGH; reinforced by the duplication smell. Trivial observability fix.
- **Focus-visible "fix one sibling, miss the next" (MAJOR-2)** — critic (harness gap) + designer (4 concrete live misses D19-01/07/08/09). Strong combined signal.
- **Upload quota single-settle point (A3 + MINOR-2)** — **2 agents** (architect A3 generator-framing, critic MINOR-2 window-blind residual).
- **deleteOriginalUploadFile** — all agents correctly skipped (FALSE POSITIVE).

---

## Lead triage (what to implement vs defer this cycle)

### IMPLEMENT (high-value, low-risk, actionable now)
1. **MINOR-1 (critic, HIGH)** — add `console.error('search enrichment failed', e)` to both `api/search/semantic/route.ts:333-336` and `similar/[id]/route.ts:234-237`. Observability; trivial.
2. **F1 (debugger)** — `lib/view-retention.ts:43` replace `Number.parseInt(env,10)` with `Number(env)` so `1e3` → 1000 not 1. Prevents silent near-emptying of view tables. Correctness/data-loss prevention.
3. **F2 (debugger, privacy)** — `lib/gps-exif-strip.ts` ISOBMFF walker: an oversized/64-bit box early-exit currently returns `{stripped:false}`, which does NOT trigger the metadata-free re-encode fallback → GPS survives. Treat the anomalous early-exit as a signal to fall back (return null / re-encode). Privacy — not deferrable.
4. **A2 / MAJOR-1 (3-agent)** — extract compile-guarded `searchEnrichmentSelectFields` in `data.ts`; both search routes import it. Deletes duplication + adds tsc-time PII guard. Low-risk (same columns).
5. **D19-07 (designer, HIGH)** — skip link `focus:not-sr-only` → `focus-visible:not-sr-only` (`app/[locale]/layout.tsx:125`, `not-found.tsx:21`).
6. **D19-01 (designer, HIGH)** — `lightbox.tsx:613` move focus ring from invisible full-height hitbox to the visible circular affordance via `group` + `group-focus-visible:ring-*`.
7. **D19-08 (designer, MED)** — hardcoded `focus-visible:outline-blue-500` → `ring-ring` token in `image-zoom.tsx:347`, `lightbox-color-pip.tsx:161`, `login-form.tsx:84` (also closes deferred D18-02 siblings).
8. **D19-09 + D19-05 (designer, LOW)** — upload-dropzone remove button `focus:`→`focus-visible:` (`upload-dropzone.tsx:472`); `text-[10px]`→`text-xs` badges (`info-bottom-sheet.tsx:272,277`).
9. **CQ19-04 (code-reviewer, LOW)** — extract `humanizeColorPrimariesOrLabel` to `lib/color-label.ts`; import in color-details-section + wide-gamut-hint.
10. **CQ19-03 (code-reviewer, LOW)** — wrap `copyColorMetadata` in `useCallback` (`lightbox-color-pip.tsx:88`).
11. **Test FINDING-1 (test-engineer, MED)** — add behavioral tests for `rollbackOgAttempt` (`rate-limit.ts:261-270`), paralleling the existing 5 `rollbackSemanticAttempt` tests.
12. **CQ19-02 (code-reviewer, MED)** — `BoundedMap.entries()` yield shallow-copied values to match `get()` semantics (latent mutation hazard; no live caller).

### EVALUATE-THEN-IMPLEMENT-OR-DEFER
- **A3 / MINOR-2 — upload quota single-settle.** Architect's `claimSettled` try/finally is the structural fix; correctness-sensitive on the hot upload path. Implement the smaller, well-contained MINOR-2 (window-identity-blind settle) if it can be done cleanly; evaluate the full try/finally restructure (defer if risk outweighs the LOW self-healing instance impact).
- **CQ19-01 — OG 60s worst-case.** Bound the cold/broken path (cap retried sizes or add an aggregate deadline). Medium value; implement if low-risk.

### DEFER (structural migration / scale-gated / acceptable) — see plan deferred list
- **MAJOR-2 general focus-visible scanner** — meaningful new test infra; risk of regex churn (touch-target audit took many cycles). Fix concrete designer findings now; defer the scanner with exit criterion.
- **A1 topics.slug onUpdate:cascade / surrogate PK migration** — deliberate migration; FK-registry net adequate. Exit: 4th FK child or routine renames.
- **A4 restore-maintenance DB-backed flag / startup fence** — scale-out only; single-replica deployment is the current fence. Exit: any multi-replica deploy.
- **A5 storage dead-module whitelist-or-delete** — no live importer. Exit: first importer.
- **A6 view-buffer extraction from data.ts** — cohesion only. Exit: next behavioral change.
- **D19-04 EXIF dl/dt/dd semantics** — AA 1.3.1; markup refactor risk. **D19-02/03/06 reduced-motion** — global catch-all already covers; AAA.
- **SEC-19-01 IPv6 /64** — defense-in-depth; account bucket covers worst case. **SEC-19-02** token pre-DB throttle — marginal.
- **PERF-C19-01..05** — scale-gated / micro. **Test FINDING-2** lr-upload functional harness — larger; FINDING-3/4 minor.

## AGENT FAILURES
None. All 11 agents completed and their per-agent file is fresh (cycle-19).
