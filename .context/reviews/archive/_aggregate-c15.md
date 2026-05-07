# Cycle 15 Review Aggregate

**Date:** 2026-04-30
**Review source:** c15-comprehensive-review.md (single-agent multi-perspective review)

## Actionable Findings (NEW this cycle)

| ID | Severity | Confidence | File | Description | Action |
|----|----------|------------|------|-------------|--------|
| C15-MED-01 | MEDIUM | HIGH | `apps/web/src/lib/sanitize.ts:82-86` | `requireCleanInput` returns non-null `value` on `rejected:true`, unlike `sanitizeAdminString` which returns `null`. Contract inconsistency could lead to future callers persisting stripped visually-identical strings. | Add early-return for Unicode formatting matching `sanitizeAdminString`, or add null-on-rejected contract |
| C15-MED-02 | MEDIUM | MEDIUM | `apps/web/src/lib/data.ts:887-912` | `getImageByShareKey` uses two `GROUP_CONCAT` with different ORDER BY (name vs slug), causing potential name-slug misalignment when parsed by index position | Align both GROUP_CONCATs to ORDER BY the same column (slug), or use combined delimiter pattern |
| C15-LOW-02 | LOW | HIGH | `apps/web/src/app/actions/seo.ts:71-81` | Double Unicode formatting check (sanitizeAdminString before normalizeStringRecord) — defense-in-depth but undocumented | Add comment documenting the intentional overlap |
| C15-LOW-04 | LOW | MEDIUM | `apps/web/src/lib/data.ts:99-106` | flushGroupViewCounts re-buffers into new map; capacity check is theoretical only at personal-gallery scale | No fix needed; informational |
| C15-LOW-05 | LOW | HIGH | `apps/web/src/app/[locale]/admin/db-actions.ts:76` | CSV headers hardcoded in English (carry-forward of C13-03) | Deferred (previously recorded) |

## Deferred (carry-forward, no change from prior cycles)

All previously deferred items from plan 336 (cycle 14) and plan 374 (cycle 13) remain deferred with no change in status:

- C14-MED-03 / C30-04 / C36-02 / C8-01: `createGroupShareLink` BigInt coercion risk on `insertId`
- C14-LOW-01: `original_file_size` BigInt precision risk
- C14-LOW-02: `lightbox.tsx` showControls callback identity instability
- C14-LOW-03: `searchImages` alias branch over-fetch
- A17-MED-02 / C14-LOW-04: CSP `style-src 'unsafe-inline'` in production
- A17-MED-01 / C14-LOW-05: `data.ts` god module (1258 lines)
- A17-MED-03 / C14-LOW-06: `getImage` parallel DB queries — pool exhaustion risk
- A17-LOW-04 / C14-LOW-07: `permanentlyFailedIds` process-local — lost on restart
- C9-TE-03-DEFER: `buildCursorCondition` cursor boundary test coverage
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D4-MED: CSP unsafe-inline
- C13-03 / C15-LOW-05: CSV export column headers hardcoded in English
- All other items from prior deferred lists

## Agent Failures

No agent failures — single-agent review completed successfully.
