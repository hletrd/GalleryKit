# Cycle 2 — Deferred Findings Record

**Cycle:** 2/100 (review-plan-fix loop)
**HEAD:** `c73dc56 docs(reviews): record cycle-3 fresh review and plan-316 no-op convergence`
**Date:** 2026-04-28
**Aggregate:** `.context/reviews/_aggregate-cycle2-2026-04-28.md`

## Summary

Fifth consecutive cycle returning **zero new MEDIUM/HIGH findings**. The codebase is in a converged state. All 6 findings this cycle are LOW severity or INFO, and all are either intentional design decisions, carried-forward items, or scale-appropriate trade-offs.

This file is a deferral record. No implementation work is scheduled.

## Deferred items

### Architect lens

- **C2-AR-01** — `deleteAdminUser` uses raw SQL via `conn.query()` instead of Drizzle ORM. File: `apps/web/src/app/actions/admin-users.ts:218-240`. Severity LOW, Confidence Low. Carried forward from C1-28-F01. Reason for deferral: advisory lock (`GET_LOCK`) requires a dedicated pool connection, and Drizzle's transaction API doesn't support pinning a specific connection. The parameterized queries are safe. Re-open criterion: Drizzle adds a `connection` parameter to transactions that supports advisory locks on a pinned connection.

- **C2-AR-02** — `restoreDatabase` and `withTopicRouteMutationLock` similarly use raw SQL for advisory locks on dedicated connections. Files: `apps/web/src/app/[locale]/admin/db-actions.ts:271-328`, `apps/web/src/app/actions/topics.ts:37-57`. Severity LOW, Confidence Low. Same architectural justification as C2-AR-01. Re-open criterion: same as C2-AR-01.

### Code-quality lens

- **C2-CR-01** — `getAdminImagesLite` does not accept `topic` or `tagSlugs` filter parameters unlike `getImagesLite` and `getImagesLitePage`. File: `apps/web/src/lib/data.ts:483-505`. Severity LOW, Confidence Low. Reason for deferral: at personal-gallery scale the admin dashboard can load the full image set without filtering. Adding topic/tag params would require a new client-side filter UI and is low ROI. Re-open criterion: gallery exceeds 10K images and admin dashboard load time becomes noticeable, or a feature request asks for admin-side filtering.

### Test-engineer lens

- **C2-TE-01** — No integration/E2E test for the full upload-to-processed-image lifecycle. Severity LOW, Confidence Low. Reason for deferral: unit tests cover each step individually (save, process, queue, enqueue). The Playwright E2E suite covers admin flows. A full end-to-end lifecycle test would require a running MySQL instance and Sharp binary, making it more of an integration test than a unit test. Re-open criterion: a bug is found in the upload-to-processed flow that individual unit tests missed.

### Document-specialist lens

- **C2-DS-01** — CLAUDE.md says "TypeScript 6" without minor version. File: `CLAUDE.md`. Severity INFO, Confidence Low. Reason for deferral: the project's `package.json` is the authoritative source for the exact version; CLAUDE.md's role is to state the major version requirement. Re-open criterion: a minor-version-specific API change requires documenting the minimum minor version.

### Performance lens

- **C2-PR-01** — `exportImagesCsv` materializes up to 50K rows as CSV in memory (~15-25MB peak). File: `apps/web/src/app/[locale]/admin/db-actions.ts:33-105`. Severity INFO, Confidence Low. Already documented in code comment (C3-F01). Reason for deferral: personal-gallery scale rarely approaches 50K rows; the code already caps at 50K and releases the DB results array before joining. A streaming API route would add complexity. Re-open criterion: a gallery exceeds 30K images and CSV export causes noticeable memory pressure.

## Repo-policy compliance

- **Security/correctness/data-loss not deferrable unless explicitly allowed**: none of the items above are security, correctness, or data-loss defects. All are architectural consistency notes, coverage gaps, documentation precision notes, or scale observations.
- **Severity preserved**: all items recorded at original LOW/INFO severity; none downgraded.
- **Re-open criteria**: every item has an explicit re-open criterion.
- **Citations**: every item carries file+line citations pointing at current HEAD.

## Status

This is a **record-only** plan file. No implementation work scheduled. The cycle-2 loop closes with convergence confirmed.
