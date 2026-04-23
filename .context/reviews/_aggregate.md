# Cycle 4 Aggregate Review

## Scope
Merged and deduped the available cycle-4 review outputs plus a leader verification pass against the current checkout.

Inputs used:
- `.context/reviews/code-reviewer.md`
- `.context/reviews/security-reviewer.md`
- manual source verification against current files
- `.context/reviews/available-agents-cycle4.txt`

## MERGED FINDINGS

### F1 — Public read surfaces stay live during restore maintenance, causing inconsistent UX and avoidable load
- **Severity:** Medium
- **Confidence:** High
- **Signal:** code-reviewer + leader verification
- **Category:** correctness / performance / operational safety
- **Files / regions:**
  - `apps/web/src/lib/restore-maintenance.ts:1-38`
  - `apps/web/src/app/actions/public.ts:1-76`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:244-286`
- **Problem:** `restoreDatabase()` explicitly enters restore maintenance and quiesces buffered writes / image processing, but public server actions (`loadMoreImages`, `searchImagesAction`) continue to hit the DB. That keeps expensive pagination/search reads alive during restore and can surface partial data or transient DB failures to end users.
- **Failure scenario:** An admin starts a restore; while DDL/DML is replaying, visitors keep scrolling or searching. The app continues issuing gallery/search reads against a half-restored DB, increasing load and returning empty/partial/inconsistent responses.
- **Suggested fix:** Short-circuit public server actions during restore maintenance before any DB/rate-limit work. Add regression coverage proving both actions return empty results when maintenance is active.

### F2 — `/api/health` does not honor restore maintenance, contradicting repo docs and keeping readiness green during restore
- **Severity:** Medium
- **Confidence:** High
- **Signal:** leader verification against docs + source
- **Category:** correctness / ops / performance
- **Files / regions:**
  - `apps/web/src/app/api/health/route.ts:1-18`
  - `apps/web/src/lib/restore-maintenance.ts:1-38`
  - `CLAUDE.md:177-180` (readiness/docs contract)
- **Problem:** Repo docs state `/api/health` is DB-aware readiness/diagnostics and can legitimately return `503` during DB outages **or restore work**, but the route currently only checks DB reachability. If the DB is reachable during restore maintenance, readiness incorrectly stays green.
- **Failure scenario:** A restore is in progress but DB connectivity remains up. Probes keep receiving `200 {status:"ok"}` from `/api/health`, so upstream orchestration continues routing traffic to an intentionally degraded instance.
- **Suggested fix:** Make `/api/health` return `503` with a restore-specific status when `isRestoreMaintenanceActive()` is true. Add regression coverage.

## INVALIDATED / NON-ACTIONABLE REVIEW CLAIMS

These were raised by individual reviewers but do **not** survive current-source verification:

1. **Reserved locale slug/alias bug** from `code-reviewer.md` — invalidated by current source. `apps/web/src/lib/validation.ts:1-9` already includes `...LOCALES` in `RESERVED_TOPIC_ROUTE_SEGMENTS`.
2. **Histogram worker request mix-up** from `code-reviewer.md` — invalidated by current source and tests. `apps/web/src/components/histogram.tsx:18-81`, `apps/web/public/histogram-worker.js:1-22`, and `apps/web/src/__tests__/histogram.test.ts:1-53` already use/request `requestId` correlation.
3. **AWS S3 SDK vulnerable dependency finding** from `security-reviewer.md` — invalid for the current production manifest. `apps/web/package.json` has no `@aws-sdk/client-s3` or `@aws-sdk/s3-request-presigner` dependency.
4. **Password-change CSRF origin-check gap** from `security-reviewer.md` — invalidated by current source. `apps/web/src/app/actions/auth.ts:272-285` already checks `hasTrustedSameOrigin(requestHeaders)`.
5. **Weak example secret in current tree** from `security-reviewer.md` — current tree already uses placeholders and explicit compromised-history rotation guidance in `apps/web/.env.local.example:15-23` and `README.md:66-76`.

## AGENT FAILURES

The orchestrator requested these registered reviewer agents, but the Agent tool failed twice due the platform thread limit (`collab spawn failed: agent thread limit reached (max 6)`), so no per-agent report could be collected this cycle:
- `critic`
- `verifier`
- `test-engineer`
- `architect`
- `debugger`
- `designer`

Requested but not registered in this environment:
- `perf-reviewer`
- `tracer`
- `document-specialist`

## DEDUPE NOTES
- The only surviving cross-source finding is the restore-maintenance read/readiness gap.
- Several reviewer claims were stale relative to the current checkout and were filtered out above.
