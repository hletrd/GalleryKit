# Plan 332 — Cycle 14 Fixes

Date: 2026-04-29
Status: Completed

## Findings to address

### C14-AGG-01 (Low / Low). `audit.ts` metadata `preview` truncation produces a JSON fragment — confusing for forensic analysts

- **Source**: C14-CR-03, C14-SEC-01, C14-CRIT-01, C14-V-01 (4 agents)
- **File**: `apps/web/src/lib/audit.ts:29-33`
- **Issue**: When audit metadata exceeds 4096 bytes, the code slices the serialized JSON at 4000 code points and wraps it as `{ truncated: true, preview: "<raw-slice>" }`. The `preview` field is a raw character slice of the JSON string, which may terminate mid-key or mid-value, producing an invalid JSON fragment inside a valid JSON envelope. While `truncated: true` correctly indicates data was cut, the preview itself is noise rather than useful context.
- **Impact**: Low — this is a diagnostic quality issue, not a security or correctness bug. The `truncated: true` flag is present.
- **Fix**: Append an ellipsis (`"..."`) marker to the preview string so it is unambiguously marked as a truncated fragment. Add a code comment documenting that `preview` may contain invalid JSON fragments and is for human debugging only.

### C14-AGG-02 (Low / Low). `deleteAdminUser` uses raw SQL without explicit rationale comment

- **Source**: C14-CR-02 (1 agent)
- **File**: `apps/web/src/app/actions/admin-users.ts:206-229`
- **Issue**: The function uses raw `conn.query()` with parameterized SQL for the advisory lock, admin count check, user lookup, session deletion, and user deletion. While this is necessary for the advisory lock (which requires a dedicated connection that persists across multiple queries), the rationale for using raw SQL instead of Drizzle ORM is implicit, not documented.
- **Impact**: Low — the code is correct and parameterized. This is a maintainability/documentation concern.
- **Fix**: Add a code comment explaining why raw SQL is used here (advisory lock requires a dedicated connection that persists across multiple queries, which Drizzle's connection pool doesn't directly support).

## Implementation plan

1. Edit `apps/web/src/lib/audit.ts:29-33` — append `"..."` to the preview string and add a code comment.
2. Edit `apps/web/src/app/actions/admin-users.ts:206` — add a code comment explaining the raw SQL rationale.

## Deferred findings (not addressed this cycle)

None new. All carry-forward deferred items from prior cycles remain unchanged.

## Exit criteria

- [ ] `audit.ts` preview truncation includes ellipsis marker and documentation comment
- [ ] `admin-users.ts` raw SQL rationale documented with code comment
- [ ] All gates pass: eslint, tsc --noEmit, build, vitest, lint:api-auth, lint:action-origin
- [ ] Changes committed and pushed
