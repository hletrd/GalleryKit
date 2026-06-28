# Run-22 Cycle-22 — Aggregated Review

**Date:** 2026-06-29
**HEAD:** 6ef2495d (cycle-21 T1–T6 + SW stamp + gitignore chore landed)
**Agents:** 11/11 completed (code-reviewer, security-reviewer [opus], perf-reviewer [via general-purpose], critic [opus], architect [opus], verifier, test-engineer, tracer, debugger, document-specialist, designer)
**Agent Failures:** 0 (3 opus agents hit a transient request-throttle on the first fan-out batch and were re-spawned successfully — not a failure)
**Baseline gates (own run + verifier-confirmed):** eslint exit 0, tsc exit 0, vitest **2195 pass / 4 skip** (241 files), lint:api-auth / lint:action-origin (42 exports) / lint:public-route-rate-limit all exit 0. `npm audit --omit=dev` 0 vulns.

---

## Convergence summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | Security-reviewer (opus): 0 confirmed-exploitable across the full OWASP sweep (22nd consecutive clean security cycle). |
| HIGH | 0 | None runtime. Designer's D22-01 (histogram tooltip-trigger) is a11y-cosmetic (no `outline-none`, UA-default ring still renders) — consistency gap, not a WCAG hard-failure. |
| MEDIUM | 3 | **(1) Focus-visible scanner blind spots — 2-agent (critic M1 + designer D22-01/D22-02 + designer's own recommendation).** The cycle-21 durable scanner missed a real sibling on its FIRST cycle: `app/global-error.tsx:78` (outside SCAN_ROOTS) and two `cursor-*`/no-`hover:` buttons (`histogram.tsx:707`, `map-client.tsx:128`) the `hover:`-only heuristic can't see. **(2) DOC22-M3** — CLAUDE.md claims `siteConfig.url` is "validated at startup … fails loud at build time" but the code only validates per-request (OG route try/catch → 404); operator-misleading. **(3) DBG22-03** — admin dashboard `parseInt(pageParam)` mis-parses `?page=1e3`→1 (the env-parse class, now on a query param). |
| LOW (actionable) | 4 | **DBG22-02** shutter `1/Infinity` for subnormal-float EXIF (`image-types.ts:121`, one-line isFinite guard). **critic m1** `envPositiveInt('0.5')`→`Math.floor(0.5)=0` → SEMANTIC_SCAN_LIMIT=0 (scan nothing) instead of fallback. **DOC22-M1/M2** stale NEXT_UPLOAD_BODY_MAX_BYTES literal + process-image.ts line refs. **DOC22-G1** admin_tokens schema row omits the functional scope model (lr:upload/lr:read/lr:delete). |
| INFO / LOW-latent | 4 | **SEC-22-INFO** envPositiveInt no upper clamp (operator-env-only, non-exploitable). **ARCH22-01** clip-embeddings env-read leaf module also imported by `'use client'` search.tsx (benign today; config-divergence trap for first client consumer). **TRACE22-NEW-01** images.ts auth-order comment "matches existing action pattern" is misleading (other files call isAdmin() first; functionally identical). **DBG22-01** local-time Date methods in on-this-day-widget / analytics-data (harmless in the shipped UTC deployment; the data-timeline.ts:241 sub-claim is a FALSE POSITIVE — see below). |
| DOC | 21 MATCH / 3 MISMATCH / 1 GAP | All 4 cycle-21 doc findings (DOC21-M1/G1/G2/G3) confirmed CLOSED. New: DOC22-M3 (operator-misleading), DOC22-M1/M2 (stale literals/line-refs), DOC22-G1 (admin_tokens scope gap). |
| STRUCTURAL / DEFER (carried) | ~10 | A1 topics.slug (3 FK children — exit UNMET, best-fenced); A3 upload single-settle (15 awaits / 6 settles, 0 new await — exit UNMET); A4 restore-maintenance scale-out fence (byte-unchanged); A5 @/lib/storage dead module (0 importers, quarantine guard intact); A6/N1/N2 data.ts cohesion + PrivacySensitiveKeys 20-key union (no new PII column); PERF-C19/20/21 carried (all scale-gated, exit UNMET); TEST21-02 IMAGE_CLEANUP_CONCURRENCY untested. |

**Verdict:** Mature, exceptionally hardened. Zero new live CRIT/HIGH; security 0-exploitable for the 22nd cycle. The headline signal: **the focus-visible scanner shipped last cycle as the durable net — and missed a real sibling on its very first cycle** (critic M1) PLUS has a heuristic blind spot for non-`hover:` interactive buttons (designer D22-01/D22-02). Two agents independently surfaced the same structural weakness. Fix the 3 controls AND close both scanner blind spots (location + signal) this cycle. Secondary: a small cluster of cheap correctness/consistency fixes (dashboard parseInt, shutter isFinite, envPositiveInt floor guard) and doc-gap closures (DOC22-M3 operator-misleading is the priority).

---

## Cross-agent agreement (higher signal)

- **Focus-visible scanner blind spots — 2 agents (critic M1 + designer D22-01/D22-02), and the designer independently recommended the same heuristic extension.** The cycle-21 scanner (`__tests__/focus-visible-links-scan.test.ts`) walks only `components/` + `app/[locale]/` (misses the framework-mandated non-locale `app/global-error.tsx:78`) and fires only when a standalone `hover:` token is present (misses `<button class="cursor-help …">` at `histogram.tsx:707` and `<button onClick class="cursor-pointer …">` at `map-client.tsx:128`). Blast-radius probe: extending SCAN_ROOTS to all of `app/` surfaces exactly global-error.tsx; adding a `cursor-(pointer|help)` second signal (restricted to Link/a/button) flags exactly the two real misses — the other `cursor-*` hits are `<Label>`/`<Badge>`/`role=option` and are correctly NOT matched. **Implement: fix all 3 + extend the scanner on both axes, re-seed to 0.**
- **env/user-input parse sweep — re-confirmed COMPLETE for env vars; one NEW user-input variant (debugger DBG22-03).** Critic retracted the two route-param `parseInt` sites (`api/og/photo/[id]:55`, `api/search/similar/[id]:78`) as false positives — both fenced by a strict `/^\d+$/` guard before parseInt. The one remaining real instance is `admin/(protected)/dashboard/page.tsx:12` `parseInt(pageParam||'1',10)` (no regex fence; clamps to [1,1000] but mis-parses scientific notation). Same class as cycle-20's env sweep + cycle-21's topics-order fix.
- **clip-embeddings.ts envPositiveInt (cycle-21 T4) — 3 agents touched it:** critic m1 (`'0.5'`→0 floor edge, VERY LOW), security SEC-22-INFO (no upper clamp, operator-env-only), architect ARCH22-01 (server-only env-read in a leaf module also imported by a client component — config-divergence latent). The floor-guard (critic m1) is the actionable one; the upper clamp folds in for free; ARCH22-01 defers (no client consumer of those symbols today).

---

## Skeptical validation (findings checked and DOWNGRADED/REJECTED)

- **DBG22-01 `data-timeline.ts:241` is a FALSE POSITIVE.** The debugger claimed `new Date(img.capture_date).getMonth()` can bucket a photo to the wrong month and recommended `getUTCMonth()`. But `capture_date` is `'YYYY-MM-DD HH:mm:ss'` (space-separated, non-ISO) which V8 parses as LOCAL wall-clock; reading `.getMonth()` (also local) is the identity round-trip for the month field regardless of TZ. **Switching to `getUTCMonth()` would INTRODUCE an off-by-one near month boundaries** (parse-as-local + read-as-UTC desync). Do NOT apply that fix. The on-this-day-widget / analytics-data sub-claims are real local-time reads but no-ops in the shipped UTC Docker deployment and semantically ambiguous (server-local vs UTC "today") — DEFER, don't "fix" blindly.
- **TRACE22-NEW-01** (auth-order comment) — LOW/Informational, comment-only, zero behavioral/security impact (both orderings reject the identical request set). Whether the comment is even "wrong" is debatable (it accurately matches the images.ts file-internal convention). DEFER rather than churn.

---

## Lead triage (implement vs defer this cycle)

### IMPLEMENT (actionable now)
1. **T1 — Focus-visible: fix 3 controls + close both scanner blind spots** (2-agent, MEDIUM). global-error.tsx:78 + histogram.tsx:707 + map-client.tsx:128 get `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (+ `rounded`/`rounded-md`). Scanner: `SCAN_ROOTS`→`[components/, app/]` (dedupe files); add `CURSOR_TOKEN = /(?<![\w-])cursor-(pointer|help)\b/` as a second interactive signal alongside `HOVER_TOKEN`; add self-check fixtures; re-seed KNOWN_VIOLATIONS to 0.
2. **T2 — DBG22-03**: dashboard/page.tsx:12 `parseInt(pageParam||'1',10)`→`Number(pageParam||'1')` + focused test.
3. **T3 — DBG22-02**: image-types.ts:121 add `Number.isFinite(denominator) &&` before the `Math.abs(...)` check + test (subnormal `ExposureTime`).
4. **T4 — critic m1 + SEC-22-INFO**: envPositiveInt — guard the FLOORED result (`Math.floor(n) >= 1`) so `'0.5'`→fallback, and add a generous upper clamp (`Math.min(floored, 1_000_000)`) for the operator-misconfig belt-and-braces + test.
5. **T5 — TEST21-01**: export `MAX_INPUT_PIXELS` (non-TOPIC) from process-image.ts + a `vi.resetModules()` env-parse test (the topic cap is covered; the full-size cap that guards the decompression bomb is not).
6. **T6 — Doc fixes**: DOC22-M3 (MEDIUM — correct the `siteConfig.url` "startup/build-time validation" claim to the actual per-request fail-closed pattern, both occurrences), DOC22-M1 (NEXT_UPLOAD_BODY_MAX_BYTES literal 279620608→278921216), DOC22-M2 (process-image.ts line refs), DOC22-G1 (admin_tokens functional scope model + expires_at/last_used_at).
- Also: KEEP the 2 tests the test-engineer agent already wrote (GAP-1 updateTopic sci-notation in topics-actions.test.ts; GAP-2 similar-route SEMANTIC_SCAN_LIMIT in semantic-scan-limit-source.test.ts) — verify they pass.

### DEFER (see cycle-22-deferred.md)
DBG22-01 (timezone local-time reads — data-timeline part is a false positive; rest harmless-in-UTC + semantically ambiguous); TRACE22-NEW-01 (auth-order comment, cosmetic); ARCH22-01 (clip-embeddings server/client env split — exit: first client reference to the env consts); A1/A3/A4/A5/A6/N1 (all exit UNMET, file:line-verified by architect); all carried PERF-C19/20/21; TEST21-02 IMAGE_CLEANUP_CONCURRENCY; carried Test FINDING-3/4; SEC-19-01/02 (re-confirmed unchanged, nginx edge-throttle covers the LR-upload path).

---

## Per-agent headline (provenance: per-agent files are fresh cycle-22)

- **code-reviewer** — 0 new findings. APPROVE. All cycle-21 deferred items confirmed unchanged (exit criteria unmet).
- **security-reviewer [opus]** — 0 CRIT/HIGH/MED/LOW-new, 1 INFO (SEC-22-INFO envPositiveInt no upper clamp, operator-env-only). `npm audit` 0 vulns. SEC-19-02 re-verified BETTER-fenced than the cycle-21 note (nginx zone=admin covers the LR-upload location).
- **perf-reviewer** — 0 new findings, 0 regressions. All 9 prior deferrals re-confirmed (no exit criterion triggered). Cycle-21 T3/T4 verified correct at HEAD.
- **critic [opus]** — ACCEPT-WITH-RESERVATIONS. M1 (scanner missed global-error.tsx — the repo's signature "fix one sibling, miss the next" landed INSIDE the artifact built to prevent it), m1 (envPositiveInt floor edge). Retracted 2 route-param parseInt false positives. T2/T3/T5/T6 verified correct.
- **architect [opus]** — byte-stable since cycle-21 (schema.ts / images.ts / restore-maintenance.ts / advisory-locks.ts byte-unchanged). 1 NEW: ARCH22-01 (clip-embeddings client/server env-symbol divergence, DEFER). All 6 deferred exit criteria UNMET with file:line evidence. Single-writer topology still safe.
- **verifier** — PASS, 0 blockers. All 6 gates exit 0. All cycle-21 T1–T6 fixes present + structurally correct; both new env tests non-vacuous; 8 behavioral spot-checks MATCH.
- **test-engineer** — HEALTHY. Wrote 2 additive tests (GAP-1 updateTopic sci-notation; GAP-2 similar-route SEMANTIC_SCAN_LIMIT). Carried: TEST21-01 (non-TOPIC MAX_INPUT_PIXELS still untested — needs export), TEST21-02 (deferred).
- **tracer** — 6 flows traced, all CONFIRMED-CORRECT. 1 NEW LOW/Info (TRACE22-NEW-01 auth-order comment). R21C21 T3 retry-counter cleanup present + test-locked. A3 enforcement-test probe suggested (defer).
- **debugger** — DBG21-01 confirmed FIXED (no regression). 3 new: DBG22-02 (shutter 1/Infinity, actionable), DBG22-03 (dashboard parseInt, actionable), DBG22-01 (timezone — partly false-positive, see Skeptical validation; defer).
- **document-specialist** — 21 MATCH / 3 MISMATCH / 1 GAP. All cycle-21 doc findings closed. DOC22-M3 (MEDIUM operator-misleading), DOC22-M1/M2 (LOW stale), DOC22-G1 (admin_tokens scope gap).
- **designer** — 2 new (D22-01 histogram tooltip-trigger HIGH-cosmetic, D22-02 map popup button MED) + confirmed the scanner blind spot (heuristic fires only on `hover:`) and recommended the second-pass extension. i18n parity (780 keys), reduced-motion, headings, skip-link, focus-trap, ARIA, touch-targets all PASS.

## AGENT FAILURES
None. All 11 agents completed. 3 opus agents (security-reviewer, critic, architect) hit a transient "Server is temporarily limiting requests" throttle on the first parallel batch (subagent_tokens: 0) and were immediately re-spawned to completion — per the run's transient-throttle rule this is not a failure. The cycle-21 per-agent files were archived to `.context/reviews/archive/cycle-21/` before this run overwrote them.
