# Aggregate review — cycle 2 rpl

Generated: 2026-04-23. HEAD: `00000006e`.

Per-agent source files:
- `.context/reviews/code-reviewer-cycle2-rpl.md`
- `.context/reviews/security-reviewer-cycle2-rpl.md`
- `.context/reviews/perf-reviewer-cycle2-rpl.md`
- `.context/reviews/critic-cycle2-rpl.md`
- `.context/reviews/verifier-cycle2-rpl.md`
- `.context/reviews/test-engineer-cycle2-rpl.md`
- `.context/reviews/tracer-cycle2-rpl.md`
- `.context/reviews/architect-cycle2-rpl.md`
- `.context/reviews/debugger-cycle2-rpl.md`
- `.context/reviews/document-specialist-cycle2-rpl.md`
- `.context/reviews/designer-cycle2-rpl.md`

Aggregation rules: (1) Dedupe overlapping findings, preserving highest severity/confidence across agents. (2) Record cross-agent agreement as "Signal". (3) Keep per-agent files untouched for provenance.

## Consolidated findings

### AGG2R-01 — `updatePassword` outer catch lacks `unstable_rethrow`
- **Signal:** code-reviewer (CR2R-01), critic (CRIT2R-02), verifier (V2R-06), debugger (DBG2R-01), tracer (Trace 2).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/src/app/actions/auth.ts:382`.
- **Action:** add `unstable_rethrow(e);` as the first line of the outer catch at line 382, mirroring the login path. This is a narrow 1-line fix with a direct precedent in the same file.

### AGG2R-02 — Server-action provenance (`hasTrustedSameOrigin`) not enforced on mutating actions outside `auth.ts`
- **Signal:** code-reviewer (CR2R-02), security-reviewer (SEC2R-01), critic (CRIT2R-01), architect (ARCH2R-01), tracer (Trace 1), test-engineer (TE2R-01).
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Citation:** grep shows `hasTrustedSameOrigin` used only in `apps/web/src/app/actions/auth.ts:19,93,274`. Missing on all of `images.ts`, `tags.ts`, `topics.ts`, `sharing.ts`, `admin-users.ts`, `seo.ts`, `settings.ts`, `[locale]/admin/db-actions.ts`.
- **Action:** factor a helper that runs `isAdmin()` + `hasTrustedSameOrigin(headers)` (after reading `headers()`) and return a localized unauthorized error on failure; apply to every mutating action. Pair with a static-scan test (TE2R-01) that asserts every `'use server'` mutation path calls the helper. Reopens/replaces pre-existing deferral D1-02 (which has been deferred across multiple cycles).

### AGG2R-03 — `restoreDatabase` reads GET_LOCK result via `Object.values(lockRow)[0]` instead of a named alias
- **Signal:** debugger (DBG2R-02).
- **Severity / confidence:** LOW / MEDIUM.
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:260-267`.
- **Action:** rename the SQL alias to `AS acquired` and read `lockRow.acquired` explicitly, matching the admin-delete pattern at `admin-users.ts:186-189`.

### AGG2R-04 — Admin mobile nav scroll affordance (pre-existing D1-03)
- **Signal:** code-reviewer (CR2R-03), designer (UX2R-02).
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** pre-existing deferral D1-03 — re-defer.

### AGG2R-05 — `uploadImages` returns dead `replaced: []` in response shape
- **Signal:** code-reviewer (CR2R-04).
- **Severity / confidence:** LOW / HIGH (confidence it's dead).
- **Action:** defer — cleanup-only, not behavior-affecting.

### AGG2R-06 — CSV export build-all-in-memory / streaming CSV (pre-existing D6-05)
- **Signal:** perf-reviewer (PERF2R-02), code-reviewer (CR2R-06).
- **Disposition:** pre-existing deferral — re-defer.

### AGG2R-07 — Duplicate in-memory rate-limit maps across four files (pre-existing plan-142)
- **Signal:** code-reviewer (CR2R-05), architect (ARCH2R-03).
- **Disposition:** pre-existing deferral — re-defer.

### AGG2R-08 — `searchImages` runs up to 3 sequential round-trips on cold-path searches
- **Signal:** perf-reviewer (PERF2R-01).
- **Severity / confidence:** LOW / HIGH.
- **Disposition:** defer — semantic-changing refactor.

### AGG2R-09 — `bootstrapImageProcessingQueue` pulls all unprocessed rows without pagination
- **Signal:** perf-reviewer (PERF2R-03).
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** defer.

### AGG2R-10 — Session clock-drift lower bound not enforced
- **Signal:** security-reviewer (SEC2R-04).
- **Severity / confidence:** LOW / LOW.
- **Disposition:** defer.

### AGG2R-11 — CSP `'unsafe-inline'` hardening (pre-existing D1-01)
- **Signal:** security-reviewer (SEC2R-05).
- **Disposition:** pre-existing deferral — re-defer.

### AGG2R-12 — No regression test for concurrent `updatePassword` rate-limit-clear-after-commit ordering
- **Signal:** test-engineer (TE2R-05).
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** defer.

### AGG2R-13 — `aria-busy` missing on settings-client save button
- **Signal:** designer (UX2R-05).
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** defer (next UI polish cycle).

### AGG2R-14 — Plan directory hygiene (historical context spread across 170+ files)
- **Signal:** critic (CRIT2R-03).
- **Severity / confidence:** LOW / MEDIUM (informational).
- **Disposition:** informational, not scheduled.

### AGG2R-15 — `getImageIdsForSitemap` has no `id` tie-breaker
- **Signal:** debugger (DBG2R-03).
- **Severity / confidence:** LOW / LOW.
- **Disposition:** defer.

## Cycle 1 rpl claims — all verified TRUE on HEAD
- C1R-01 (fail-closed same-origin default) — VERIFIED.
- C1R-02 (password-change rate-limit clear after commit) — VERIFIED.
- C1R-03 (admin login page skips protected chrome) — VERIFIED.
- C1R-04 (normalized values returned + rehydrated) — VERIFIED.
- C1R-05 (seed-e2e.ts honors configured image sizes) — VERIFIED.
- C1R-06 (seed slugs lowercase) — VERIFIED.
- C1R-07 (e2e admin lane auto-enabled locally + GPS toggle) — VERIFIED.

## Agent failures
None.

## Signals of cross-agent agreement
- 6 agents flag AGG2R-02 (code-reviewer, security-reviewer, critic, architect, tracer, test-engineer).
- 5 agents flag AGG2R-01 (code-reviewer, critic, verifier, debugger, tracer).

## Cycle 2 scheduling recommendation
1. Schedule AGG2R-01 as a narrow 1-line fix + regression test — MEDIUM severity, high confidence, small diff.
2. Schedule AGG2R-02 as a factoring + static-scan gate — MEDIUM severity, medium confidence, moderate diff. Closes the multi-cycle D1-02 deferral.
3. Schedule AGG2R-03 as an opportunistic consistency fix — LOW severity, but mechanical and safe to ship alongside AGG2R-01/02.
4. Defer everything else per strict deferred-fix rules (repo policy: AGENTS.md "keep diffs small, reviewable, reversible").
