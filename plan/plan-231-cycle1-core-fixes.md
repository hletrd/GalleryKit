# Plan 231 — Cycle 1 review fixes

Status: complete
Created: 2026-04-24
Reviews: `.context/reviews/_aggregate.md` plus per-agent files in `.context/reviews/`

## Repo rules read before planning
- `CLAUDE.md`: Node 24+, formal gates, security lint gates, local-only storage warning, git workflow.
- `AGENTS.md`: always commit/push; use gitmoji.
- `.context/**`: previous reviews/plans; no stricter deferral policy found beyond existing review-plan-fix artifacts.
- `.cursorrules`, `CONTRIBUTING.md`, `docs/**`: not present / no additional policy files found.

## Implementation scope for this cycle

Every aggregate finding is either scheduled below, already fixed/validated, or recorded in `plan/plan-232-cycle1-deferred.md`.

### P0 — Build/security correctness
- [x] AGG-001: Fresh checkout / CI lacks `apps/web/src/site-config.json`.
  - Files: `.github/workflows/quality.yml`, `apps/web/src/site-config.example.json`.
  - Acceptance: CI creates/copies the config before build/e2e; local build still passes.
- [x] AGG-002: Precomputed Argon2 hash support mismatch in automatic migration.
  - File: `apps/web/scripts/migrate.js`.
  - Acceptance: migration stores `$argon2*` values directly and hashes only plaintext; tests or script inspection cover both branches.
- [x] AGG-003/004: Admin API 401s lack no-store; future routes need safer wrapper default.
  - File: `apps/web/src/lib/api-auth.ts`.
  - Acceptance: unauthorized wrapper responses include no-store headers and existing route tests pass.
- [x] AGG-006: Typecheck includes volatile `.next/dev/types`.
  - Files: `apps/web/tsconfig.typecheck.json`, `apps/web/package.json`, `package.json`.
  - Acceptance: the dedicated typecheck config excludes `.next/dev` while leaving Next-managed `tsconfig.json` intact; `npm run typecheck` passes.
- [x] AGG-007: E2E seed loads `.env.local` too late.
  - File: `apps/web/scripts/seed-e2e.ts`.
  - Acceptance: dotenv loads before env-dependent modules are imported.
- [x] AGG-024: `UPLOAD_MAX_FILES_PER_WINDOW` documented but hard-coded.
  - Files: `apps/web/src/lib/upload-limits.ts`, `apps/web/src/app/actions/images.ts`, env/docs.
  - Acceptance: validated env parser backs both per-call and cumulative checks.
- [x] AGG-011: `createTopic` leaks topic image on route-conflict early return.
  - File: `apps/web/src/app/actions/topics.ts`.
  - Acceptance: processed topic image is cleaned before returning conflict.

### P1 — SEO/social/metadata correctness
- [x] AGG-012/013: Sitemap dynamic/revalidate contradiction and request-time lastModified churn.
  - File: `apps/web/src/app/sitemap.ts`.
  - Acceptance: route contract is explicit; unchanged home/topic entries no longer emit `new Date()` as lastModified.
- [x] AGG-015: Custom OG image missing from Twitter metadata on home/topic pages.
  - Files: public home/topic pages.
  - Acceptance: `twitter.images` mirrors configured custom OG images and tests/inspection verify.
- [x] AGG-016: Filtered home/topic SEO policy inconsistent.
  - Files: public home/topic metadata.
  - Acceptance: filtered pages consistently canonicalize to their base route and include noindex when filtered.
- [x] AGG-020: Download key/name still implies original despite JPEG copy.
  - Files: messages/photo viewer.
  - Acceptance: code uses `downloadJpeg` key/name and download filename is `.jpg`.

### P2 — UI/accessibility correctness
- [x] AGG-036: Footer admin link contrast too low.
- [x] AGG-037: Tag picker missing `aria-activedescendant` and stable option ids.
- [x] AGG-038: Search result roles mix listbox and links.
- [x] AGG-039: Password confirmation error not field-linked.
- [x] AGG-040: Settings/SEO pages silently fall back to blank editors.
- [x] AGG-041: Infinite scroll lacks explicit manual load trigger.
- [x] AGG-042: Info bottom sheet initial state mismatch.

### P3 — Operational/performance bounded fixes
- [x] AGG-044/045: Queue bootstrap is unbounded and does not retry after DB outage.
  - File: `apps/web/src/lib/image-queue.ts`.
  - Acceptance: bootstrap loads pending rows in bounded batches and schedules retry after transient DB connection failure.
- [x] AGG-026: Sharp concurrency docs mismatch code.
  - File: `apps/web/.env.local.example`.
  - Acceptance: docs say CPU count - 1.

### P4 — Documentation correctness
- [x] AGG-021/022/023/025/027/028/029/030/031/032/033/034/035: docs/README/env copy updates that are safe and do not introduce new product scope.
  - Files: `README.md`, `CLAUDE.md`, `apps/web/README.md`, `apps/web/.env.local.example`, storage comments.
  - Acceptance: claims align with current host-network/local-only behavior and onboarding has explicit init/site-config/admin steps.

## Gate requirements
Run after implementation:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

## Progress log
- 2026-04-24: Plan created from cycle-1 aggregate.
- 2026-04-24: Completed scheduled P0-P4 fixes, added regression coverage for admin auth cache headers, upload file-count env parsing, queue bootstrap batching/retry, and authenticated origin guard E2E.
- 2026-04-24: Gates passed: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` (54 files / 315 tests), `npm run test:e2e` (20 tests). Build/E2E still emit the known Next.js edge-runtime static-generation warning for `apps/web/src/app/api/og/route.tsx`; deferred in `plan-232` because `next/og` requires edge runtime.
- 2026-04-24: Architect verification rejected the initial queue batching because failed low-id rows could starve later rows; fixed bootstrap pagination with an id cursor and added regression coverage for continuation scanning.
