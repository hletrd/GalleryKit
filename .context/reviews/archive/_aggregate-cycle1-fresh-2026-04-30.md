# Aggregate Review — Cycle 1 Fresh (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c1f-code-reviewer.md`) — 8 findings
2. **security-reviewer** (`c1f-security-reviewer.md`) — 8 findings
3. **perf-reviewer** (`c1f-perf-reviewer.md`) — 6 findings
4. **architect** (`c1f-architect.md`) — 5 findings
5. **debugger** (`c1f-debugger.md`) — 5 findings
6. **test-engineer** (`c1f-test-engineer.md`) — 6 findings
7. **critic** (`c1f-critic.md`) — 4 findings
8. **designer** (`c1f-designer.md`) — 5 findings

## AGENT FAILURES

None — all review agents completed successfully.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### HIGH severity (confirmed by multiple agents)

#### A1-HIGH-01: `login` rate-limit rollback gives attacker extra attempts
- **Sources**: C1F-CR-04 (Medium/Medium), C1F-SR-01 (Medium/High), C1F-TE-02 (Medium/High)
- **3 agents agree** — highest signal finding
- **Location**: `apps/web/src/app/actions/auth.ts:249-258`
- **Issue**: When login verification fails with an unexpected error (infrastructure failure, not wrong password), the code rolls back the pre-incremented rate-limit count. This reduces the failed-attempt budget, giving the attacker extra attempts. Over repeated DB blips in a 15-minute window, an attacker could get significantly more than 5 attempts.
- **Fix**: Don't roll back on unexpected errors (accept the lost attempt as infrastructure cost), or use a separate "infrastructure error" counter that doesn't affect the failed-attempt budget.

#### A1-HIGH-02: Image processing queue bootstrap re-enqueues permanently-failing images
- **Sources**: C1F-DB-02 (Medium/High), C1F-TE-04 (Medium/Medium)
- **2 agents agree**
- **Location**: `apps/web/src/lib/image-queue.ts:328-333`
- **Issue**: When a job fails `MAX_RETRIES` (3) times, the code sets `state.bootstrapped = false` and schedules a bootstrap retry. The next bootstrap will re-enqueue the same permanently-failing job, creating an infinite loop.
- **Fix**: Add persistent failure tracking (DB column or file) so the bootstrap query can exclude permanently-failing images.

### MEDIUM severity

#### A1-MED-01: `getImage` runs 4 parallel DB queries — connection pool exhaustion under load
- **Sources**: C1F-PR-06 (Medium/Medium)
- **Location**: `apps/web/src/lib/data.ts:649-764`
- **Issue**: Each photo view runs 4 parallel DB queries, consuming 4 of the 10 pool connections. Under concurrent views, the pool queues additional requests (limit 20).
- **Fix**: Combine prev/next into a single query, or increase pool size.

#### A1-MED-02: `exportImagesCsv` materializes up to 50K rows in memory
- **Sources**: C1F-PR-01 (High/High)
- **Location**: `apps/web/src/app/[locale]/admin/db-actions.ts:58-106`
- **Issue**: CSV export loads up to 50K rows and builds a ~25MB in-memory string. On memory-constrained Docker containers, this could cause OOM.
- **Fix**: Implement streaming CSV API route.

#### A1-MED-03: Server actions use inconsistent auth patterns
- **Sources**: C1F-AR-03 (Medium/Medium)
- **Location**: `apps/web/src/app/actions/*.ts`
- **Issue**: Three different auth check patterns exist across mutating actions. The inconsistency could lead to future errors.
- **Fix**: Standardize on a single auth pattern with a `requireAuth()` helper.

#### A1-MED-04: `sanitizeAdminString` returns stripped value even when `rejected=true`
- **Sources**: C1F-CR-08 (Medium/Medium), C1F-TE-05 (Low/Medium)
- **2 agents agree**
- **Location**: `apps/web/src/lib/sanitize.ts:130-148`
- **Issue**: If a caller ignores the `rejected` flag, the stripped value (which looks visually identical) gets persisted silently. Current callers check `rejected`, but future callers may not.
- **Fix**: Return `null` as value when `rejected` is true, forcing explicit handling.

#### A1-MED-05: `getClientIp` returns "unknown" without TRUST_PROXY — rate limiting disabled
- **Sources**: C1F-SR-07 (Medium/Medium)
- **Location**: `apps/web/src/lib/rate-limit.ts:92-123`
- **Issue**: In reverse-proxy deployments without `TRUST_PROXY=true`, all users share the "unknown" rate-limit bucket, effectively disabling rate limiting.
- **Fix**: Document the `TRUST_PROXY` requirement prominently. Consider a startup-time check.

#### A1-MED-06: View count buffer — re-buffered increments after failed flush may exceed cap
- **Sources**: C1F-DB-01 (High/High)
- **Location**: `apps/web/src/lib/data.ts:98-106`
- **Issue**: Re-buffered entries bypass the size check if their group ID already exists in the new buffer. The overflow is bounded but the cap can be exceeded.
- **Fix**: Check total buffer size after re-buffering and drop oldest entries if over cap.

#### A1-MED-07: `data.ts` is 1123 lines with mixed concerns
- **Sources**: C1F-AR-02 (Medium/Medium)
- **Location**: `apps/web/src/lib/data.ts`
- **Issue**: Single file contains view counts, privacy guards, queries, cursors, search, and SEO. Merge-conflict hotspot.
- **Fix**: Split into focused modules.

#### A1-MED-08: CSP `style-src 'unsafe-inline'` in production
- **Sources**: C1F-SR-02 (Medium/High)
- **Location**: `apps/web/src/lib/content-security-policy.ts:82`
- **Issue**: `'unsafe-inline'` in style-src enables CSS-based data exfiltration vectors, though modern browsers mitigate the worst cases.
- **Fix**: Long-term, migrate to nonce/hash-based style-src. Short-term, document the tradeoff.

### LOW severity

#### A1-LOW-01: `image-manager.tsx` — 6 empty catch blocks
- **Sources**: C1F-CR-05 (Low/Low)
- **Location**: `apps/web/src/components/image-manager.tsx` lines 136, 164, 188, 213, 246, 429
- **Fix**: Add `console.warn` or `console.error` to the delete/update error catches.

#### A1-LOW-02: `console.log()` in db/seed.ts and db/index.ts
- **Sources**: C1F-CR-06 (Low/Low)
- **Location**: `apps/web/src/db/seed.ts:26`, `apps/web/src/db/index.ts:5,10`
- **Fix**: Replace with `console.debug()`.

#### A1-LOW-03: Multiple oversized functions
- **Sources**: C1F-CR-07 (Medium/Low)
- **Fix**: Refactor large functions into named helpers.

#### A1-LOW-04: Incomplete env var documentation in CLAUDE.md
- **Sources**: C1F-CT-04 (Low/Low)
- **Fix**: Add comprehensive env var reference.

#### A1-LOW-05: `restoreDatabase` temp file predictability
- **Sources**: C1F-SR-03 (Medium/Medium)
- **Fix**: Use `O_CREAT | O_EXCL` for atomic file creation.

#### A1-LOW-06: Process-local state prevents horizontal scaling
- **Sources**: C1F-AR-01 (High/High)
- **Note**: Documented design constraint — not a bug.
- **Fix**: No fix needed at current scale. Document for future.

#### A1-LOW-07: `getImage` prev/next needs edge-case tests for identical timestamps
- **Sources**: C1F-TE-01 (High/High)
- **Fix**: Add unit test for batch-uploaded images with identical timestamps.

#### A1-LOW-08: `sanitizeStderr` doesn't redact DB_HOST, DB_USER, DB_NAME
- **Sources**: C1F-SR-08 (Low/Low)
- **Fix**: Consider redacting all DB connection parameters.

#### A1-LOW-09: `deleteImage` orphaned files after DB deletion
- **Sources**: C1F-DB-03 (Medium/Medium)
- **Fix**: Consider periodic orphan-file cleanup job.

#### A1-LOW-10: No loading skeleton for `/p/[id]`
- **Sources**: C1F-UX-03 (Low/Medium)
- **Fix**: Add `loading.tsx` in `p/[id]` directory.

#### A1-LOW-11: Lightbox auto-hide timer may feel sluggish on slow devices
- **Sources**: C1F-UX-02 (Medium/Medium)
- **Fix**: Reset auto-hide timer on any user interaction.

#### A1-LOW-12: `publicSelectFields` pattern is clever but fragile
- **Sources**: C1F-CT-03 (Medium/Medium)
- **Fix**: Consider defining `publicSelectFields` explicitly.

#### A1-LOW-13: View count buffer has no external alerting on sustained failure
- **Sources**: C1F-PR-03 (Medium/Medium)
- **Fix**: Add a process-level counter exposed via `/api/health`.

---

## Summary statistics

- Total findings across all agents: 47 (before dedup)
- Deduplicated findings: 24
- HIGH severity: 2
- MEDIUM severity: 8
- LOW severity: 14
- Cross-agent agreement (2+ agents): 4 findings (A1-HIGH-01, A1-HIGH-02, A1-MED-04, and A1-LOW-03/A1-LOW-07 overlap)
