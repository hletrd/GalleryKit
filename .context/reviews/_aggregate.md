# Cycle 3 Ultradeep Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 3 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

Completed specialist reviews used for this aggregate:
- `code-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `architect.md` *(architect agent returned the review content but was blocked from writing due a read-only constraint; the orchestrator persisted the returned markdown to the file path)*
- `debugger.md`
- `designer.md`
- `document-specialist.md`
- `dependency-expert.md`

Prompt-requested reviewers that were not registered as native agent roles in this environment:
- `perf-reviewer`
- `tracer`

## Dedupe rules

- Duplicate findings are merged below under a single finding ID.
- Severity/confidence reflect the strongest reviewer that raised the issue.
- “Signals” lists every reviewer that independently reinforced the same root issue.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C3-01 | HIGH | High | security-reviewer | Migration/startup DB scripts skip the runtime TLS policy, so production boot can talk to non-local MySQL without TLS. | `apps/web/scripts/migrate.js:531-537`, `apps/web/scripts/migrate-capture-date.js:24-30`, `apps/web/src/db/index.ts:5-24`, `apps/web/Dockerfile:75-79` |
| C3-02 | HIGH | High | code-reviewer | Restore still runs without a real runtime write barrier / queue quiescence, so a live restore can mix restored DB state with concurrent queue or mutation writes. | `apps/web/src/app/[locale]/admin/db-actions.ts:232-257,330-390`, `apps/web/src/lib/image-queue.ts:135-216,291-335`, `apps/web/src/instrumentation.ts:5-26` |
| C3-03 | MEDIUM | High | critic | Restore’s ingress limit is misaligned with the documented 250 MB action limit: the framework can still accept up to the broader server-action body-size limit before the app rejects it. | `apps/web/src/app/[locale]/admin/db-actions.ts:224-279`, `apps/web/next.config.ts:96-100`, `apps/web/src/lib/upload-limits.ts:1-22` |
| C3-04 | HIGH | High | code-reviewer, critic, debugger | `image_sizes` is an unsafe live toggle: existing derivatives are not regenerated, and the server accepts arbitrarily long size lists that can explode future processing cost. | `apps/web/src/app/actions/settings.ts:35-85`, `apps/web/src/lib/gallery-config-shared.ts:48-53,95-101`, `apps/web/src/lib/process-image.ts:345-423`, `apps/web/src/components/home-client.tsx:249-287`, `apps/web/src/components/photo-viewer.tsx:201-221`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:167-173` |
| C3-05 | MEDIUM | High | critic | `updateTopic()` no longer enforces the same 100-character label contract that `createTopic()` and the admin UI still imply. | `apps/web/src/app/actions/topics.ts:62-64,117-145`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:167-168,245-246` |
| C3-06 | MEDIUM | High | critic | Topic image processing failures are swallowed and surfaced to admins as a full success instead of an explicit warning/failure. | `apps/web/src/app/actions/topics.ts:66-73,152-158`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:59-84` |
| C3-07 | MEDIUM | High | debugger | Topic/tag renames and deletes do not invalidate cached photo pages, so week-long ISR pages can keep stale topic labels/tag chips. | `apps/web/src/app/actions/topics.ts:161-206`, `apps/web/src/app/actions/tags.ts:42-214`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:129-235` |
| C3-08 | MEDIUM | High | code-reviewer | Shared-group gallery cards fetch OG-sized derivatives (~1536px) instead of grid-sized thumbnails, inflating mobile/shared-page transfer and decode cost. | `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:95-98,153-174` |
| C3-09 | MEDIUM | High | code-reviewer | CSV export still double-buffers rows in memory despite the comment claiming incremental behavior. | `apps/web/src/app/[locale]/admin/db-actions.ts:37-91` |
| C3-10 | MEDIUM | High | debugger | Image deletion hides filesystem cleanup failures, which can leave orphaned public files still servable by direct upload URLs. | `apps/web/src/app/actions/images.ts:347-383,440-503`, `apps/web/src/lib/serve-upload.ts:28-113` |
| C3-11 | HIGH | High | dependency-expert | Auth action imports a private internal Next.js redirect-error module, creating a fragile framework-coupling risk on minor upgrades. | `apps/web/src/app/actions/auth.ts:5-7,210-230` |
| C3-12 | HIGH | High | designer | Photo download action nests interactive controls (`a > button`), which is invalid HTML and an accessibility defect. | `apps/web/src/components/photo-viewer.tsx:528-538` |
| C3-13 | HIGH | High | designer | Mobile info bottom sheet claims modal semantics even when focus is not trapped in peek/collapsed states. | `apps/web/src/components/info-bottom-sheet.tsx:31-39,140-188` |
| C3-14 | HIGH | High | designer | Topic alias delete icon button has no accessible name. | `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:261-269` |
| C3-15 | MEDIUM | High | designer | Route loading announcements are hardcoded in English instead of localized. | `apps/web/src/app/[locale]/loading.tsx:1-7`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:1-7` |
| C3-16 | MEDIUM | High | critic | `/api/admin/*` auth “lint” is a string search; a comment or unused import can satisfy the check and let an unwrapped route pass CI. | `apps/web/scripts/check-api-auth.ts:1-31`, `apps/web/src/lib/api-auth.ts:1-16` |
| C3-17 | MEDIUM | High | verifier | `getImage()` still claims legacy `processed = NULL` support that the query does not implement. | `apps/web/src/lib/data.ts:377-392`, `apps/web/drizzle/0002_fix_processed_default.sql:1` |
| C3-18 | LOW | High | verifier, document-specialist, architect | Storage-backend switching is still advertised in code/comments/messages even though the settings pipeline and file I/O paths do not support it end-to-end. | `apps/web/src/lib/storage/index.ts:1-18,113-183`, `apps/web/src/lib/gallery-config-shared.ts:1-44`, `apps/web/messages/en.json:532-539`, `apps/web/messages/ko.json:532-539` |
| C3-19 | HIGH | High | dependency-expert | S3 storage `writeStream()` fully buffers uploads into memory instead of streaming them to the SDK. | `apps/web/src/lib/storage/s3.ts:95-115` |
| C3-20 | MEDIUM | High | dependency-expert | Dead native deps/toolchain (`better-sqlite3`, `@types/better-sqlite3`, `@vitejs/plugin-react`) add avoidable production-build complexity and image size. | `apps/web/package.json:56-73`, `apps/web/Dockerfile:3-10` |
| C3-21 | MEDIUM | High | document-specialist | Docs treat `site-config.json` as a required operator-provided file, but the build and Docker path silently synthesize it from the example. | `README.md:149-153`, `CLAUDE.md:219-227`, `apps/web/package.json:8-10`, `apps/web/Dockerfile:35-36`, `apps/web/deploy.sh:21-23` |
| C3-22 | MEDIUM | High | document-specialist | `DEPLOY_REMOTE_SCRIPT` is supported by the deploy helper but not documented in the main README. | `README.md:95-105`, `.env.deploy.example:4-12`, `scripts/deploy-remote.sh:22-43,57-63` |
| C3-23 | MEDIUM | High | security-reviewer | Repository history contains a previously committed real-looking session secret / insecure bootstrap defaults; current HEAD is fixed, but the historical secret must be treated as burned. | git history for `apps/web/.env.local.example`, commits `d7c3279`, `d068a7f` |

## Risks / follow-up items needing explicit disposition

| ID | Severity | Signals | Risk |
|---|---|---|---|
| R3-01 | medium-high | architect | Auth/service layering is inverted (`lib` and public pages depend on `app/actions/auth`), increasing future auth-refactor risk. |
| R3-02 | medium-high | architect | The read/query layer is not side-effect free (`getSharedGroup()` mutates buffered view counts). |
| R3-03 | medium | architect | `admin/db-actions.ts` is a cross-layer god module that mixes auth, shelling out, temp files, auditing, validation, and revalidation. |
| R3-04 | medium | dependency-expert | S3 bucket auto-create path omits region-specific `CreateBucketConfiguration`, which can break AWS bucket bootstrap outside `us-east-1`. |
| R3-05 | medium | dependency-expert | Compose deployment assumes Linux host networking and host-managed MySQL. |
| R3-06 | medium | dependency-expert | Current MySQL TLS defaults may not support self-signed/private-CA deployments without extra operator guidance. |
| R3-07 | low | verifier | E2E currently validates `next start`, not the standalone Docker entrypoint. |
| R3-08 | medium | debugger | Share-link rate limiting is split between a shared in-memory map and type-specific DB buckets. |
| R3-09 | low | document-specialist | Storage backend docs/strings and dormant code are easy to over-trust until the feature is either removed or finished. |

## Aggregate conclusions

Highest-signal implementation targets this cycle:
1. **Restore hardening** — C3-01, C3-02, C3-03
2. **Image-size setting safety** — C3-04
3. **Topic mutation correctness/UX** — C3-05, C3-06, C3-14, C3-15
4. **Public-cache correctness + deletion cleanup** — C3-07, C3-10
5. **Auth/framework hardening** — C3-11, C3-16

Lower-priority or broader follow-up items that should be explicitly deferred if not fixed now:
- C3-08, C3-09, C3-17, C3-18, C3-19, C3-20, C3-21, C3-22, C3-23
- R3-01 through R3-09

## Agent notes / failures

- `architect` returned a full review but could not persist its own file because of an internal read-only constraint. The orchestrator wrote the returned markdown to `./.context/reviews/architect.md` so the review is preserved and included here.
- Requested `perf-reviewer` and `tracer` roles were not available in this environment, so they were skipped rather than silently omitted.
