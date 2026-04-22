# Cycle 11 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 11 (`deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`, `go on`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `verifier`
- `test-engineer`
- manual repo-wide sweep

Completed specialist notes this cycle also include:
- `architect`
- `designer`

Still pending / stalled after retries and session-thread limits:
- `debugger`
- `dependency-expert`

The remaining stalled lanes are treated as execution failures for provenance, so this aggregate preserves completed evidence plus the manual ultradeep sweep.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C11-01 | HIGH | High | code-reviewer, manual sweep | Non-ASCII tag names are accepted by validation but previously collapsed to empty/colliding ASCII-only slugs. | `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/images.ts` |
| C11-02 | MEDIUM | High | critic, code-reviewer | Share creation coupled photo/group in-memory budgets and charged existing photo-link copy flows. | `apps/web/src/app/actions/sharing.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx` |
| C11-03 | MEDIUM | High | critic, manual sweep | Topic aliases accepted dotted path segments that locale middleware skips as asset-like routes. | `apps/web/src/lib/validation.ts`, `apps/web/src/proxy.ts` |
| C11-04 | MEDIUM | Medium | security-reviewer | Login lacked a same-origin request guard for session-establishing POSTs. | `apps/web/src/app/actions/auth.ts` |
| C11-05 | MEDIUM | High | manual sweep, prior deferred UX note | Lightbox controls auto-hide on touch-only devices, leaving mobile users without persistent visible controls. | `apps/web/src/components/lightbox.tsx` |
| C11-06 | LOW | High | manual sweep, prior deferred UX note | Tag input trapped Tab and could create case-variant duplicate pills instead of canonicalizing to existing tags. | `apps/web/src/components/tag-input.tsx` |
| C11-07 | MEDIUM | High | manual dependency/deploy sweep | The production runner image still inherited build-only toolchain packages, and remote deploys still used a merge-capable `git pull`. | `apps/web/Dockerfile`, `apps/web/deploy.sh` |
| C11-08 | MEDIUM | High | verifier | Local storage reads still trust intermediate directories and can follow symlink escapes. | `apps/web/src/lib/storage/local.ts` |
| C11-09 | MEDIUM | High | code-reviewer | EXIF parsing still accepts impossible calendar dates. | `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/exif-datetime.ts` |
| C11-10 | HIGH | High | critic, code-reviewer | Restore maintenance remains process-local / can still strand queued uploads in multi-process or race windows. | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts` |
| C11-11 | MEDIUM | High | security-reviewer, verifier | Share-link expiry/collation hardening still needs schema-level follow-up. | `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/base56.ts`, `apps/web/src/lib/data.ts` |
| C11-12 | MEDIUM | High | test-engineer | High-risk admin/share/session/upload flows still lack direct regression coverage, and nav “visual checks” do not assert visual baselines. | `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/e2e/nav-visual-check.spec.ts` |
| C11-13 | HIGH | High | architect | Backup/restore still snapshots MySQL only and can diverge from the filesystem-backed image corpus. | `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-paths.ts`, `README.md` |
| C11-14 | MEDIUM | High | architect | Public search still scales via repeated wildcard scans without a dedicated searchable projection. | `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/public.ts` |
| C11-15 | MEDIUM | High | architect | Several correctness-sensitive counters still remain process-local. | `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker.ts` |
| C11-16 | MEDIUM | High | designer | Search overlay, info sheet, admin dashboard, and fullscreen exit still have remaining UX/accessibility follow-ups. | `apps/web/src/components/search.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/lightbox.tsx` |
| C11-17 | HIGH | High | dependency-expert | Docker health checks still treat DB availability as container liveness, which can trigger restart loops during DB outages/restores. | `apps/web/Dockerfile`, `apps/web/src/app/api/health/route.ts` |
| C11-18 | MEDIUM | High | dependency-expert | Production builds still silently fall back to the example site config. | `apps/web/Dockerfile`, `README.md`, `apps/web/README.md` |
| C11-19 | MEDIUM | Medium | dependency-expert | Compose/docs still rely on host-managed nginx outside the compose stack. | `README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf` |

## Plan routing

- **Implement in Plan 193:** C11-01 through C11-07.
- **Defer in Plan 194:** C11-08 through C11-12 plus the operational audit/history items from the completed specialist notes.

## Aggregate conclusion

The highest-value bounded cycle-11 work is to fix the remaining cross-file contract mismatches that still affect live admin/public behavior without requiring schema migrations: Unicode-safe tag slugs, share-rate-limit scope/idempotence, dotted alias rejection, same-origin login checks, touch-friendly lightbox controls, non-trapping tag input behavior, and deploy/runtime hardening. The remaining storage, share-schema, restore-maintenance, EXIF validation, and broader test/ops follow-ups are real but better carried as explicit deferred work.
