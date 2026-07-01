# Cycle 75/100 Aggregate Review

Start HEAD: `29f4176df6d0147301dbf7cfc3928125fb0a049c`.

## Review Fan-Out

- Security/auth/rate-limit lane: no new security finding; targeted auth/origin/public-rate-limit/audit gates passed.
- Correctness/data-flow lane: empty feed ETag churn.
- Test/verifier lane: pending-photo OG helper lacks direct behavior coverage.
- Performance/deploy lane: per-photo OG lacks conditional caching, Cycle 74 ledger drift, stale rate-limit comment.
- UI/UX lane: bottom-sheet dropdown portal focus risk, bulk-edit validation association gap.
- Architecture/product main lane: exact ETag matching where weak comparison is required.

## Deduplicated Findings

### C75-01 - Per-photo OG generation lacks conditional caching

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:67`, `apps/web/src/app/api/og/photo/[id]/route.tsx:130`, `apps/web/src/app/api/og/photo/[id]/route.tsx:237`
- Problem: successful per-photo OG responses do not emit or honor ETags, so every revalidation repeats DB/config reads, derivative fetch, Satori render, and Sharp post-processing.
- Disposition: scheduled for Cycle 75.

### C75-02 - If-None-Match comparisons use exact string matching instead of weak comparison

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/feed.xml/route.ts:33`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:33`, `apps/web/src/lib/serve-upload.ts:238`, `apps/web/src/app/api/og/route.tsx:133`
- Problem: exact matching fails equivalent strong/weak validators even though `If-None-Match` uses weak comparison per RFC 9110 Section 13.1.2.
- Disposition: scheduled for Cycle 75.

### C75-03 - Pending-photo OG helper remains mostly source-locked

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/__tests__/og-photo-fallback.test.ts:98`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:167`, `apps/web/src/lib/data.ts:1204`
- Problem: route behavior is mocked and helper coverage is source-grep only, so pending-row behavior can regress without a direct behavior test.
- Disposition: scheduled for Cycle 75.

### C75-04 - Cycle 74 deployment/status docs are still open

- Severity: Medium
- Confidence: High
- Citations: `.context/plans/README.md:7`, `.context/plans/cycle-74-2026-07-01-plan.md:49`, `.context/reviews/_aggregate.md:3`
- Problem: Cycle 74 remains marked active/open even though Cycle 75 starts from deployed signed HEAD `29f4176d`.
- Disposition: scheduled for Cycle 75.

### C75-05 - Mobile bottom-sheet download menu portals outside the modal focus trap

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/components/info-bottom-sheet.tsx:189`, `apps/web/src/components/info-bottom-sheet.tsx:499`, `apps/web/src/components/ui/dropdown-menu.tsx:40`
- Problem: dropdown menu items render under `document.body`, outside the bottom sheet's modal/focus-trap subtree.
- Disposition: scheduled for Cycle 75.

### C75-06 - Empty Atom feeds churn content ETags

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/feed.xml/route.ts:108`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:118`
- Problem: empty feeds render the current time as `<updated>`, changing XML and ETags every request.
- Disposition: scheduled for Cycle 75.

### C75-07 - OG rate-limit rollback comment has stale count

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/lib/rate-limit.ts:45`, `apps/web/src/__tests__/og-photo-fallback.test.ts:56`, `apps/web/src/app/api/og/photo/[id]/route.tsx:61`
- Problem: the comment says the per-photo OG route has two rollbacks while source/tests enforce one.
- Disposition: scheduled for Cycle 75.

### C75-08 - Bulk-edit validation alert is not associated with the failing field

- Severity: Low
- Confidence: Medium
- Citations: `apps/web/src/components/bulk-edit-dialog.tsx:116`, `apps/web/src/components/bulk-edit-dialog.tsx:187`, `apps/web/src/components/bulk-edit-dialog.tsx:212`, `apps/web/src/components/bulk-edit-dialog.tsx:233`, `apps/web/src/components/bulk-edit-dialog.tsx:294`
- Problem: the generic alert is not programmatically associated with the invalid field.
- Disposition: deferred with explicit record in `.context/plans/cycle-75-2026-07-01-deferred.md`.

## Deferred

Only `C75-08` is newly deferred. It is low severity, medium confidence, admin-only form polish, and does not contradict repo policy. Carry-forward deferred items remain referenced in the Cycle 75 deferred artifact.
