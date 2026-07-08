# Run-10 Cycle 37/100 Implementation Plan

Date: 2026-07-08 KST
Review aggregate: `.context/reviews/_aggregate.md`
Cycle review directory: `.context/reviews/cycle37/`
Status: COMPLETE

## Repo Rules Read Before Planning

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- Current Cycle 37 reviews under `.context/reviews/cycle37/`
- `README.md`
- `apps/web/README.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

No `.cursorrules` or `CONTRIBUTING.md` file exists in this checkout.

## Scope

Close the narrow confirmed Cycle 37 breakages and source/docs mismatches that can be fixed safely in one cycle, preserve broader findings in the deferred register, run all required quality gates, commit/push signed changes, then deploy once with the repo root `npm run deploy`.

## Scheduled Work

### WP1 - Complete navigation visibility settings and restore green typecheck

Findings: `AGG-C37-01`, `AGG-C37-02`, `C37-DOC-01`

Files expected:

- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/__tests__/settings-hash.test.ts`
- related config/source-contract tests if needed
- README/CLAUDE docs if wording needs to distinguish navbar-only vs first-party discovery

Plan:

- Preserve current worktree additions for `show_timeline_nav` / `show_map_nav`, but make the contract coherent.
- Because the Settings copy says visitor visibility, propagate the flags beyond the header: footer and sitemap must omit disabled `/timeline` and `/map` first-party discovery links.
- Keep direct route access unless product policy explicitly changes; this cycle controls first-party discovery surfaces, not route authorization or data visibility.
- Fix all `GalleryConfig` test fixtures so `npm run typecheck --workspace=apps/web` passes.
- Add or update tests/source contracts proving disabled flags affect header/footer/sitemap and do not enter derivative settings hashes.
- Update docs to mention the DB-backed navigation visibility settings.

### WP2 - Move Lightroom upload mutation barrier to the actual mutation window

Finding: `AGG-C37-04`

Files expected:

- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/__tests__/lr-upload-route-behavior.test.ts` or an existing source/behavior contract

Plan:

- Remove the early `acquireAdminMutationSlot()` around pure request validation and multipart parsing.
- Keep content-length, upload tracker preclaim, multipart parse slot, filename/topic/title/description validation before the mutation slot.
- Acquire the mutation slot immediately before the topic DB lookup / upload-processing contract / filesystem and DB mutation window.
- Re-check `isRestoreMaintenanceActive()` after acquiring the mutation slot and before acquiring the upload-processing contract lock.
- Ensure every failure branch after tracker preclaim still settles the tracker.
- Add regression coverage that the slot acquisition appears after `request.formData()` in the source and that a post-parse restore check remains in place.

### WP3 - Align photo-page service-worker offline contract

Finding: `AGG-C37-07`

Files expected:

- `CLAUDE.md`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js` if the template changes require regeneration
- `apps/web/src/__tests__/sw-template-contract.test.ts` if expectations need wording/source-contract updates

Plan:

- Keep current behavior: public photo pages are excluded from the HTML offline cache because the implementation and tests already classify `/p/:id` with revocable public object pages.
- Update docs and service-worker header comments to stop promising offline fallback coverage for photo pages.
- If changing `sw.template.js`, regenerate `apps/web/public/sw.js` through the repo's existing build script and keep the normalized template/generated parity test green.

### WP4 - Surface OpenStreetMap tile privacy dependency

Finding: `AGG-C37-09`

Files expected:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `README.md` or `CLAUDE.md` if operator docs need an explicit Map tile note

Plan:

- Use the already-added English/Korean `privacy.mapTiles*` strings if present.
- Render those strings on the public Privacy page.
- Add or update a focused test/source contract proving the privacy page includes the Map tile dependency copy.
- Keep the wording factual: the public map loads OpenStreetMap tiles and tile providers may receive request metadata.

## Required Gates

Run, from repo root:

1. `npm run lint --workspace=apps/web`
2. `npm run lint:api-auth --workspace=apps/web`
3. `npm run lint:action-origin --workspace=apps/web`
4. `npm run lint:public-route-rate-limit --workspace=apps/web`
5. `npm run audit:prod`
6. `npm run typecheck --workspace=apps/web`
7. `npm run build --workspace=apps/web`
8. `npm test --workspace=apps/web`
9. `npm run test:e2e --workspace=apps/web` only if browser-flow coverage becomes required by the final UI changes.

## Progress

- [x] Review fan-out completed.
- [x] Aggregate review written.
- [x] Plan and deferred register written.
- [x] Implement WP1.
- [x] Implement WP2.
- [x] Implement WP3.
- [x] Implement WP4.
- [x] Run required gates.
- [x] Commit signed changes.
- [x] Pull --rebase and push.
- [x] Run per-cycle deploy.
- [x] Record production `/api/live` and missing-upload 404 smoke evidence.

## Gate Evidence

- Focused regression set passed before full gates: `npm test --workspace=apps/web -- --run src/__tests__/sitemap-robots.test.ts src/__tests__/cycle-11-source-contracts.test.ts src/__tests__/cycle-17-source-contracts.test.ts src/__tests__/lr-upload-hdr-gate.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/sw-template-contract.test.ts` (6 files, 105 tests).
- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run audit:prod` passed with 0 vulnerabilities.
- `npm run typecheck --workspace=apps/web` passed.
- `npm run build --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed (361 files, 3403 tests; 2 files/4 tests skipped).
- `npm run test:e2e --workspace=apps/web` passed (45 tests passed; 2 configured skips).
- `git diff --check` passed.

## Deploy Evidence

- Signed implementation commit pushed: `da67dac0 fix(cycle37): 🐛 align navigation discovery and upload restore slot`.
- `npm run deploy` passed from the repo root. The helper fast-forwarded the remote checkout to `da67dac0`, rebuilt `web-web`, recreated and started `gallerykit-web`, waited for health, and ran the documented post-up Docker cleanup.
- Production live smoke passed: `curl -fsS -D - https://gallery.atik.kr/api/live` returned `HTTP/2 200` with body `{"status":"ok"}` at Wed, 08 Jul 2026 08:10:12 GMT.
- Direct missing-upload smoke passed: `curl https://gallery.atik.kr/uploads/jpeg/__cycle37_missing_upload_smoke__.jpg` returned `HTTP_STATUS:404` with body `File not found`.
