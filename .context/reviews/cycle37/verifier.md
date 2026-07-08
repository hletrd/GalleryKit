# Cycle 37 Verifier Review

Role: verifier
Date: 2026-07-08
Scope: `/Users/hletrd/flash-shared/gallery`

Read first: `AGENTS.md`, `CLAUDE.md`, and `/Users/hletrd/.agents/skills/code-review/SKILL.md`. No product code was edited.

## Findings

### VER37-01: Photo-page offline fallback is test-pinned off despite docs claiming it works

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `CLAUDE.md:458-465` documents the SW HTML fallback as covering "dynamic public gallery/photo pages" and lists the exclusions as admin routes, revocable share pages `/s/<key>` and `/g/<key>`, public smart collections `/c/<slug>`, `/map`, and admin-rendered pages.
- `apps/web/public/sw.template.js:7-17` repeats the same contract in the shipped template header: HTML routes use a 24 h offline-only fallback because dynamic gallery/photo pages otherwise ship `no-cache`.
- `apps/web/public/sw.template.js:59-64` classifies `/p/:id` and localized `/[locale]/p/:id` as `isRevocableShareHtmlRoute`.
- `apps/web/public/sw.template.js:555-563` returns from the fetch handler for `isRevocableShareHtmlRoute(pathname) && isHtmlRoute(request)` before `event.respondWith(networkFirstHtml(request, event))`, so `/p/:id` never populates or serves the documented HTML fallback.
- `apps/web/src/__tests__/sw-template-contract.test.ts:102-112`, `apps/web/src/__tests__/sw-template-contract.test.ts:114-123`, and `apps/web/src/__tests__/sw-template-contract.test.ts:125-147` lock the opposite behavior, including `['/p/123', true]`, `['/ko/p/123', true]`, and `['/en-US/p/123', true]`.
- Normalized diff between `apps/web/public/sw.template.js` and generated `apps/web/public/sw.js` was empty, so the shipped worker carries the same bypass.

Concrete failure scenario:

A public visitor opens `/p/123` while online after SW activation, then loses network within the documented 24 h fallback window. The photo page was bypassed instead of passed through `networkFirstHtml`, so no cached HTML response exists and offline navigation fails with an offline/network error. The current SW tests pass because they encode the bypass as expected behavior, not because the documented photo-page fallback is proven.

Suggested fix:

Pick one contract and make source, docs, and tests agree. If public photo pages are meant to be core offline browsing surfaces, remove the `/p/:id` arm from `isRevocableShareHtmlRoute`, regenerate `sw.js`, and update `sw-template-contract.test.ts` to assert `/p/:id` reaches `networkFirstHtml` while `/s`, `/g`, `/c`, `/map`, and admin-rendered pages stay excluded. If photo pages are intentionally revocation-sensitive like share pages, update `CLAUDE.md` and the SW header to stop claiming photo-page offline fallback, and rename/comment the classifier so future reviewers do not treat this as accidental drift.

## Inventory / Examined Files

Guidance and prior context:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `.context/reviews/cycle37/perf-reviewer.md`

Privacy field guards:

- `apps/web/src/lib/data.ts:368-488`
- `apps/web/src/__tests__/privacy-fields.test.ts:41-162`
- `apps/web/src/lib/data-timeline.ts:21-74`
- `apps/web/src/lib/search-enrichment-fields.ts:29-47`
- `apps/web/src/db/schema.ts`

Migrations and schema drift:

- `apps/web/scripts/migrate.js:803-860`, `apps/web/scripts/migrate.js:920-993`
- `apps/web/drizzle/meta/_journal.json:140-223`
- `apps/web/drizzle/*.sql`
- `apps/web/src/__tests__/migrate-pending-migrations.test.ts`

Restore barriers and admin mutation fences:

- `apps/web/src/lib/admin-mutation-barrier.ts:1-135`
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-498`, `apps/web/src/app/[locale]/admin/db-actions.ts:612-685`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/__tests__/admin-mutation-barrier.test.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`

Rate limits and public routes:

- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/lib/rate-limit.ts:1-59`, `apps/web/src/lib/rate-limit.ts:175-217`
- `apps/web/src/app/api/search/semantic/route.ts:107-184`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:87-130`
- Public route inventory under `apps/web/src/app/**/route.ts*`

Upload contracts:

- `apps/web/src/app/actions/images.ts:87-227`, `apps/web/src/app/actions/images.ts:229-279`, `apps/web/src/app/actions/images.ts:551-611`
- `apps/web/src/app/api/admin/lr/upload/route.ts:85-201`, `apps/web/src/app/api/admin/lr/upload/route.ts:267-294`, `apps/web/src/app/api/admin/lr/upload/route.ts:536-644`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`

Color/HDR honesty:

- `apps/web/src/components/color-details-section.tsx:145-214`, `apps/web/src/components/color-details-section.tsx:532-568`
- `apps/web/src/components/lightbox-color-pip.tsx:45-110`, `apps/web/src/components/lightbox-color-pip.tsx:174-190`
- `apps/web/src/__tests__/color-details-section-delivered.test.ts`
- `apps/web/src/__tests__/lightbox-color-pip-hdr.test.ts`
- `apps/web/src/__tests__/photo-viewer-no-hdr-download.test.ts`

Service worker and cache:

- `apps/web/public/sw.template.js:1-75`, `apps/web/public/sw.template.js:360-567`
- `apps/web/public/sw.js`
- `apps/web/src/lib/sw-cache.ts:62-90`
- `apps/web/scripts/build-sw.ts:1-43`
- `apps/web/src/__tests__/sw-template-contract.test.ts:1-169`
- `apps/web/src/__tests__/sw-cache.test.ts`
- `apps/web/src/proxy.ts:112-122`

Deploy guarantees:

- `scripts/deploy-remote.sh:22-93`
- `apps/web/deploy.sh:51-103`
- `apps/web/docker-compose.yml:24-32`
- `apps/web/nginx/default.conf:115-187`, `apps/web/nginx/default.conf:274-307`
- `package.json:17-31`
- `apps/web/package.json:8-30`

## Verification Evidence

Passed:

- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/sw-template-contract.test.ts` — 3 files, 66 tests passed. Note: the SW test pass includes the documented finding because the test currently pins `/p/:id` as a bypass.
- `npm test --workspace=apps/web -- src/__tests__/upload-tracker.test.ts src/__tests__/upload-tracker-concurrency.test.ts src/__tests__/lr-upload-route-behavior.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/admin-mutation-barrier.test.ts` — 4 files, 35 tests passed.
- `npm test --workspace=apps/web -- src/__tests__/restore-upload-lock.test.ts` — 1 file, 10 tests passed.
- `npm test --workspace=apps/web -- src/__tests__/color-details-section-delivered.test.ts src/__tests__/lightbox-color-pip-hdr.test.ts src/__tests__/photo-viewer-no-hdr-download.test.ts` — 3 files, 40 tests passed.
- Normalized `diff` between `sw.template.js` and `sw.js` produced no output after replacing the version stamp.
- Journal inventory script found 31 journal entries, max `when` `1783463767421`, 11 historical non-monotonic entries as documented, and no SQL files missing from the journal or journal tags missing files.

## Surface Conclusions

- Privacy field guards: no additional finding. `publicSelectFields` and `publicMapSelectFields` omit the sensitive union in `data.ts:368-488`; the symmetric fixture in `privacy-fields.test.ts:141-162` catches new admin-only fields not classified as public or sensitive; timeline and search enrichment mirrors reuse the same `PrivacySensitiveKeys` contract.
- Migrations: no additional finding. `migrate.js:803-860` refuses unsafe baselining above cursor and DML-bearing drift; `migrate.js:920-993` leaves pending tails for Drizzle and asserts all journal hashes after migration. Current journal tail is monotonic from `0020` through `0030`.
- Restore barriers: no additional finding. `restoreDatabase` takes the restore advisory lock, upload-processing contract lock, backfill locks, durable maintenance marker, and foreground mutation drain before import; `admin-mutation-barrier.ts:76-135` provides the shared/exclusive process-local fence documented for the single-writer topology.
- Rate limits/public routes: no additional finding. The public-route scanner passed and the examined expensive public handlers pre-increment before protected work. `rate-limit.ts:1-59` documents the no-refund/refund contracts, and `getClientIp` only trusts proxy headers under `TRUST_PROXY=true`.
- Upload contracts: no additional finding. Browser uploads and LR uploads pre-claim quota before body/storage/DB work, settle claims on validation/DB failures, hold upload-processing locks over the mutation/enqueue window, and carry full processing snapshots to the queue.
- Color/HDR honesty: no additional finding. Public-visible components gate HDR, gain-map, transfer, ICC, bit-depth, and decision details on `isAdmin`, while public `avif_10bit` remains available.
- Deploy guarantees: no additional finding. Root `npm run deploy` delegates to the env-driven SSH wrapper; remote `apps/web/deploy.sh` builds/upgrades first, waits for health, then prunes stopped containers, unused images, BuildKit cache, and dangling volumes only. Compose persists gallery data through bind mounts, not Docker volumes.

## Final Missed-Issues Sweep

Final sweep terms and surfaces covered: `PrivacySensitiveKeys`, `_omit`, `publicSelectFields`, `publicMapSelectFields`, `reconcileLegacySchema`, `baselineAllJournalMigrations`, `_journal.json`, `requireSameOriginAdmin`, `acquireAdminMutationSlot`, `drainAdminMutationsForRestore`, `restoreMaintenance`, `preIncrement`, `rollback`, `@public-no-rate-limit-required`, `Content-Length`, `settleUploadTrackerClaim`, `upload-processing-contract`, `is_hdr`, `has_gain_map`, `transfer_function`, `isAdmin && isHdr`, `networkFirstHtml`, `isRevocableShareHtmlRoute`, `x-gk-admin-render`, `docker volume prune`, and bind mounts.

No other confirmed failure scenarios were found in the requested safety surfaces. Remaining unproven areas are live-browser SW offline behavior after a fix, production nginx actually reloaded with the shipped config, and production-scale DB execution plans; those require environment-level validation rather than this read-only source review.
