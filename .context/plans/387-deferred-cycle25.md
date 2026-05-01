# Plan 387-Deferred — Deferred Items (Cycle 25)

**Created:** 2026-05-01 (Cycle 25)
**Status:** Deferred

## Cycle 25 Review Summary

All 11 review agents (code-reviewer, security-reviewer, perf-reviewer, critic,
verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
examined the codebase. **Zero new findings** were identified. This is the third
consecutive cycle with no new findings, confirming full convergence.

## New Findings This Cycle

None.

## Deferred Findings (carry-forward, unchanged)

### C22-02: CSV export headers hardcoded in English despite i18n support

- **File+Line**: `apps/web/src/app/[locale]/admin/db-actions.ts:76`
- **Severity/Confidence**: LOW / Low
- **Reason for deferral**: Previously deferred as C15-LOW-05 / C13-03. CSV headers
  in English is a common interoperability convention for spreadsheet tools that
  expect stable column names regardless of UI locale. Changing to i18n-translated
  headers would break automated CSV consumers. If changed, should be an opt-in
  feature.
- **Exit criterion**: If a user specifically requests localized CSV headers, or if
  the admin UI adds a locale toggle for exports.

### A17-MED-01 / C14-LOW-05: data.ts god module (1283 lines)

- **File+Line**: `apps/web/src/lib/data.ts`
- **Severity/Confidence**: MED / Medium
- **Reason for deferral**: The module is large but internally well-organized with
  clear section comments. Splitting would require careful coordination with
  the many cached exports and React.cache() deduplication. The personal-gallery
  scale doesn't create maintainability pressure.
- **Exit criterion**: If data.ts exceeds 1500 lines or module becomes difficult to navigate.

### A17-MED-02 / C14-LOW-06: CSP style-src 'unsafe-inline' in production

- **File+Line**: `apps/web/src/lib/content-security-policy.ts`
- **Severity/Confidence**: MED / Medium
- **Reason for deferral**: shadcn/ui components use inline styles. Removing
  'unsafe-inline' from style-src requires nonce-based style injection or a
  migration to CSS modules, which is a significant refactor.
- **Exit criterion**: When shadcn/ui is migrated to nonce-compatible styling or CSS modules.

### A17-MED-03 / C14-LOW-06: getImage parallel DB queries — pool exhaustion risk

- **File+Line**: `apps/web/src/lib/data.ts:820-852`
- **Severity/Confidence**: MED / Low
- **Reason for deferral**: The three parallel queries (tags, prev, next) each
  consume one pool connection. With a pool of 10 and queue limit 20, this
  is acceptable at personal-gallery scale but could be problematic under
  concurrent load.
- **Exit criterion**: If the app needs to handle >100 concurrent photo page views, or if pool size is reduced.

### A17-LOW-04 / C14-LOW-07: permanentlyFailedIds process-local — lost on restart

- **File+Line**: `apps/web/src/lib/image-queue.ts:123`
- **Severity/Confidence**: LOW / Low
- **Reason for deferral**: On process restart, permanently-failed IDs are lost,
  causing the queue to re-attempt them. The retry mechanism (3 attempts) will
  re-mark them as permanently failed. This is a transient cost, not a data
  loss risk.
- **Exit criterion**: If the app needs to avoid re-processing previously-failed images after restarts.

### C14-LOW-01: original_file_size BigInt precision risk

- **File+Line**: `apps/web/src/db/schema.ts:50`
- **Severity/Confidence**: LOW / Low
- **Reason for deferral**: Schema uses `bigint('original_file_size', { mode: 'number' })`.
  The 200MB per-file cap is well within Number.MAX_SAFE_INTEGER. Documented in
  images.ts upload action.
- **Exit criterion**: If the per-file cap is raised above ~9 PB.

### C14-LOW-02: lightbox.tsx showControls callback identity instability

- **File+Line**: `apps/web/src/components/lightbox.tsx`
- **Severity/Confidence**: LOW / Low
- **Reason for deferral**: The callback is recreated on each render, but
  practical impact is minimal in the lightbox interaction context.
- **Exit criterion**: If React re-renders become a measurable performance issue in the lightbox.

### C14-LOW-03: searchImages alias branch over-fetch

- **File+Line**: `apps/web/src/lib/data.ts:1168-1202`
- **Severity/Confidence**: LOW / Low
- **Reason for deferral**: Tag and alias queries run in parallel and may
  over-fetch when both return results. The final `.slice(0, effectiveLimit)`
  and dedup Set ensure correctness. Over-fetch bounded by 2x effectiveLimit.
- **Exit criterion**: If search performance becomes an issue at larger gallery scale.

### C9-TE-03-DEFER: buildCursorCondition cursor boundary test coverage

- **File+Line**: `apps/web/src/lib/data.ts:548-571`
- **Severity/Confidence**: LOW / Medium
- **Reason for deferral**: The cursor pagination works correctly in production
  and is indirectly tested via the load-more flow. Direct unit tests for the
  dated-to-undated boundary transitions would improve coverage.
- **Exit criterion**: When test coverage for cursor pagination is prioritized.

### C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes

- **File+Line**: `apps/web/src/lib/data.ts:1119-1120`
- **Severity/Confidence**: MED / Low
- **Reason for deferral**: Mitigated by C19F-MED-01 fix — `searchGroupByColumns`
  is now derived from `searchFields` via `Object.values()`. Adding a column
  to `searchFields` automatically includes it in GROUP BY. The remaining risk
  is if a developer adds a column to the SELECT without adding it to
  `searchFields`, but that would be caught by TypeScript.
- **Exit criterion**: If the search query shape changes significantly.

### D1-MED: No CSP header on API route responses

- **File+Line**: `apps/web/src/app/api/admin/db/download/route.ts` and other API routes
- **Severity/Confidence**: MED / Low
- **Reason for deferral**: API routes are excluded from middleware by the
  matcher pattern. `withAdminAuth` adds nosniff but not a full CSP header.
  API routes return JSON, not HTML, so CSP is less critical.
- **Exit criterion**: If API routes serve HTML or if a CSP header is needed for API responses.

### D2-MED: data.ts approaching 1500-line threshold

- **File+Line**: `apps/web/src/lib/data.ts` (currently 1283 lines)
- **Severity/Confidence**: MED / Low
- **Reason for deferral**: Same as A17-MED-01. The module is large but organized.
- **Exit criterion**: If data.ts exceeds 1500 lines.

### D4-MED: CSP unsafe-inline

- **File+Line**: Same as A17-MED-02.
- **Severity/Confidence**: MED / Medium
- **Reason for deferral**: Same as A17-MED-02.
- **Exit criterion**: Same as A17-MED-02.
