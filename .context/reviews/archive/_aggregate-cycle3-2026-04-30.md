# Aggregate Review — Cycle 3 (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c3-code-reviewer.md`) — 7 findings (1 HIGH, 3 MEDIUM, 1 LOW, 2 dismissed)
2. **security-reviewer** (`c3-security-reviewer.md`) — 5 findings (1 HIGH, 0 MEDIUM, 1 LOW, 3 dismissed)
3. **perf-reviewer** (`c3-perf-reviewer.md`) — 5 findings (3 MEDIUM, 2 LOW)
4. **architect** (`c3-architect.md`) — 4 findings (2 MEDIUM, 2 LOW)
5. **debugger** (`c3-debugger.md`) — 5 findings (1 HIGH, 2 MEDIUM, 1 LOW, 1 dismissed)
6. **test-engineer** (`c3-test-engineer.md`) — 4 findings (1 HIGH, 2 MEDIUM, 1 LOW)
7. **critic** (`c3-critic.md`) — 3 findings (1 HIGH, 1 MEDIUM, 1 LOW)
8. **verifier** (`c3-verifier.md`) — 4 findings (1 HIGH, 1 MEDIUM, 2 LOW)
9. **designer** (`c3-designer.md`) — 2 findings (1 HIGH, 1 LOW)

## AGENT FAILURES

None — all review angles covered.

---

## Cycle 2 fix verification

- **A2-HIGH-01 (permanentlyFailedIds cleanup on deletion)**: VERIFIED correct in `images.ts:486,593`
- **A2-MED-01 (normalizeStringRecord Unicode rejection)**: VERIFIED correct in `sanitize.ts:60-62`
- **A2-MED-02 (loadMoreImages error handling on server side)**: VERIFIED server-side fix is correct, BUT the client-side `load-more.tsx` was NOT updated to handle error objects — fix is incomplete (see A3-HIGH-01)
- **A2-MED-03 (adminListSelectFields optimization)**: VERIFIED correct in `data.ts:220-271`
- **A2-MED-04 (rate-limit documentation)**: VERIFIED correct in `rate-limit.ts:1-31`
- **A2-MED-07 (view count buffer cap test)**: VERIFIED test exists at `data-view-count-flush.test.ts`

## Dismissed findings (verified as non-issues)

- **C3-SR-02** (backup download CSRF): Protected by `withAdminAuth` / `requireSameOriginAdmin`. NOT an issue.
- **C3-SR-03** (LIKE search length): 200-char cap prevents performance issues. NOT a security issue.
- **C3-SR-04** (session token random portion format): HMAC signature is the security boundary. NOT an issue.
- **C3-SR-05** (middleware session verification): Defense-in-depth design. NOT an issue.
- **C3-DB-03** (session cache dedup): Per-request cache is correct scope. NOT an issue.
- **C3-DB-05** (login transaction ordering): INSERT before DELETE is correct. NOT an issue.
- **C3-CR-06** (claimRetryCounts cleanup): Correctly cleaned up in finally block. NOT an issue.
- **C3-VF-03** (undated prev/next NULL rows): At least one condition always present. NOT an issue.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### HIGH severity (confirmed by multiple agents)

#### A3-HIGH-01: ~~`load-more.tsx` — no error handling on server action call~~ **DISMISSED — FALSE POSITIVE**
- **Sources**: C3-CR-01, C3-SR-01, C3-DB-01, C3-AR-02, C3-CT-01, C3-TE-01, C3-VF-01, C3-VF-02, C3-UX-01
- **9 agents agree** — but the finding is a false positive
- **Location**: `apps/web/src/components/load-more.tsx`
- **Issue**: All review agents flagged this as missing error handling. However, upon verification, the component ALREADY has comprehensive error handling: (1) try/catch around the server action call (lines 37-73), (2) checks for `page.status === 'error'` (line 62), (3) toast notifications for all error states (lines 59-63, 67), (4) loading state reset in the `finally` block (lines 68-72), (5) button re-enabled after error (loading reset to false). The cycle 2 fix (A2-MED-02) was complete — both server-side and client-side error handling are properly implemented. The review agents were working from an incorrect assumption about the code state.
- **Fix**: None needed — already implemented.

### MEDIUM severity

#### A3-MED-01: `searchImages` alias-query limit over-fetches
- **Sources**: C3-CR-03, C3-PR-01, C3-CT-02
- **3 agents agree**
- **Location**: `apps/web/src/lib/data.ts:1071`
- **Issue**: The alias-query limit calculation (`aliasRemainingLimit = effectiveLimit - mainIds.length`) does not account for `tagResults.length`, causing the alias query to fetch up to `effectiveLimit - mainIds.length` rows even when tag results already fill most of the remaining budget. The final `.slice(0, effectiveLimit)` ensures correct output, but the DB work is wasted.
- **Fix**: Adjust `aliasRemainingLimit` to account for `tagResults.length`, or accept the over-fetch as a trade-off for parallel execution at personal-gallery scale.

#### A3-MED-02: `getImage` — three parallel DB queries for single-image view
- **Sources**: C3-PR-02 (re-confirmation of D3-MED from plan-346)
- **Location**: `apps/web/src/lib/data.ts:788-820`
- **Issue**: Re-confirmation of the deferred UNION optimization for prev/next queries. Each photo page view runs 3 parallel DB queries. Connection pool exhaustion risk under moderate concurrent load.
- **Fix**: Deferred — implement UNION query as planned in plan-336.

#### A3-MED-03: `data.ts` file size approaching deferral threshold
- **Sources**: C3-AR-01
- **Location**: `apps/web/src/lib/data.ts` (1190 lines)
- **Issue**: The file has grown from 1136 lines (cycle 17) to 1190 lines. The deferral threshold is 1500 lines. The view-count buffer logic (lines 1-175) is the most self-contained module that could be extracted.
- **Fix**: No change this cycle. Continue monitoring. Extract view-count buffer when file exceeds 1500 lines.

### LOW severity

#### A3-LOW-01: `getImage` cursor-based pagination does not validate cursor ID upper bound
- **Sources**: C3-CR-07
- **Location**: `apps/web/src/lib/data.ts:514-539`
- **Issue**: `normalizeImageListCursor` validates `candidate.id` must be a positive integer but has no upper bound check. Extremely large IDs could cause precision issues, but MySQL INT column type and JavaScript `Number.isInteger` provide sufficient bounds.
- **Fix**: Consider adding `candidate.id <= 2147483647` guard, but not necessary at personal-gallery scale.

---

## Summary statistics

- Total findings across all agents: 40 (before dedup)
- Deduplicated findings: 6
- HIGH severity: 1 (9-agent consensus)
- MEDIUM severity: 3
- LOW severity: 1
- Cross-agent agreement (2+ agents): 2 findings (A3-HIGH-01 at 9, A3-MED-01 at 3)
- Cycle 2 fixes verified: 6/6 (1 partially incomplete — client-side error handling)
- Non-issues dismissed: 8
