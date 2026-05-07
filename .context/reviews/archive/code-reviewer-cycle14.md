# Code Reviewer — Cycle 14 (current run)

**Reviewer:** code-reviewer (logic, SOLID, maintainability)
**Scope:** Full repository — emphasis on areas previous cycles may have under-covered (error/edge branches, locale paths, admin SEO/db/sharing, deploy + nginx, drizzle migrations).
**HEAD at review:** `a308d8c` (post-cycle-13 doc commits, no code changes since cycle 13).

## Methodology

Compared to cycle 13's already-deep sweep, this lane focused on:
- Every server action under `apps/web/src/app/actions/**` (auth, images, topics, tags, sharing, seo, settings, public).
- Admin DB tooling (`apps/web/src/app/[locale]/admin/db-actions.ts`) and the authenticated download route (`apps/web/src/app/api/admin/db/download/route.ts`).
- Cross-cutting libs: `data.ts`, `image-queue.ts`, `process-image.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `serve-upload.ts`, `validation.ts`, `sql-restore-scan.ts`, `request-origin.ts`, `action-guards.ts`, `restore-maintenance.ts`, `locale-path.ts`, `csv-escape.ts`, `audit.ts`, `api-auth.ts`, `sanitize.ts`, `base56.ts`, `seo-og-url.ts`, `upload-tracker.ts`.
- Build-time gates: `scripts/check-action-origin.ts`, `scripts/check-api-auth.ts`, `scripts/entrypoint.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/drizzle/000{0,1,2}_*.sql`.
- Photo viewer + home/manager UI components, shared layout files, and translation message files.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none) | Cycle 14 found no actionable code-quality regressions. The fixes added in cycles 1–13 (TOCTOU pre-increment, settle helper, control-char gating, log-after-unlink, etc.) are all still in place with no regressions. | — | — | — |

### Cross-checks against earlier "withdrawn as false-positive" items

Per orchestrator directive, I revisited findings withdrawn in earlier cycles to confirm they remain non-issues:

- **C13-F02 (loadMoreImages float offset).** Already fixed: `apps/web/src/app/actions/public.ts:16` now reads `Math.max(Math.floor(Number(offset)) || 0, 0)`. No regression.
- **C13-F01 (uploadTracker stale fallback).** Already fixed: `apps/web/src/app/actions/images.ts:318/323` delegates to `settleUploadTrackerClaim` (`apps/web/src/lib/upload-tracker.ts:12-26`), which short-circuits when `tracker.get(ip)` returns `undefined`. No regression.
- **C13-F03 (deleteImages audit-log ordering).** The current code at `apps/web/src/app/actions/images.ts:507-515` only logs when `deletedRows > 0`; this matches the single-delete pattern (`apps/web/src/app/actions/images.ts:402-403`). Concern is moot.
- **C13-F04 (createTopicAlias misleading catch).** Re-checked — `apps/web/src/app/actions/topics.ts:411-415` returns `failedToCreateTopic` (a generic error) for non-MySQL exceptions; `invalidAliasFormat` is only returned by the validation guard at line 380. No issue.
- **C12-F01 to F05.** All confirmed fixed via the commits referenced in `_aggregate-cycle13.md` ("Previously Fixed — Confirmed Resolved").

### Areas re-confirmed clean this cycle

- Same-origin enforcement is intact across all mutating actions; the `lint:action-origin` gate (re-run pre-fix) reports `All mutating server actions enforce same-origin provenance.`
- API admin auth wrapper invariant intact; `lint:api-auth` reports `OK: src/app/api/admin/db/download/route.ts`.
- Privacy guard (`_privacyGuard` compile-time assertion in `apps/web/src/lib/data.ts:198-200`) still rejects sensitive keys from `publicSelectFields`.
- The 11 `eslint-disable-next-line` directives in the repo are all justified and accompanied by explanatory comments.
- No `TODO`/`FIXME`/`XXX`/`HACK` comments introduced.
- Drizzle migration files are stable.

## Verdict

Cycle 14 is the **third consecutive cycle** with zero actionable code-review findings. Convergence on the surfaces this lane covers is genuine — the only changes since cycle 12 have been doc commits.
