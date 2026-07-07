# Verifier Review - Cycle 8 Lane

Date: 2026-07-07
HEAD reviewed: `eca55414` (`fix(cycle-7): 🐛 harden review findings`)
Mode: verifier/read-only review. No fixes, commits, pushes, deploys, service actions, or database mutations were performed. This artifact is the only intended write.

## Inventory

I read the repo instructions first:
- `AGENTS.md`
- `CLAUDE.md`
- `code-review` skill instructions

I then built this working inventory:
- Policy and gate scripts: root `package.json`, `apps/web/package.json`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/build-sw.ts`, `apps/web/scripts/generate-pwa-icons.ts`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Routes and actions: all `apps/web/src/app/**/route.{ts,tsx}` files; all `apps/web/src/app/actions/*.ts`; admin DB actions; LR PAT upload route; public analytics actions; public map/timeline/year/smart-collection route coverage.
- Privacy/schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/drizzle/meta/_journal.json`, migrations `0021`, `0026`, `0027`, `0028`, `0029`, and reconcile/index mirrors in `migrate.js`.
- Admin/LR flows: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, LR token/upload tests.
- Runtime/browser tests: `apps/web/playwright.config.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`, `apps/web/e2e/*.spec.ts`.
- Generated/deploy invariants: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, deploy script contract tests, PWA icon generator/source contract.
- Review/plan context: prior root `.context/reviews/verifier.md`, latest run-9 cycle-8 aggregate/verifier, and `plan/done/plan-369-cycle8-fixes.md`.

Fresh read-only evidence:
- `npm run lint:api-auth --workspace=apps/web`: pass; `db/download` and `lr/upload` routes OK.
- `npm run lint:action-origin --workspace=apps/web`: pass; all mutating server actions enforce same-origin provenance or approved public/read-only shape.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; 10 public route files classified OK.
- `npm run lint --workspace=apps/web`: pass.
- In-memory SW generation check: expected `36c91deb-p7`; committed `apps/web/public/sw.js` also has `36c91deb-p7`; generated output matches template exactly.
- Migration journal tail check: 30 entries; current max and last entry are `0029_feed_updated_indexes` with `when=1783397921062`. The known historical non-monotonic `0006`/`0007` ordering remains, but CLAUDE.md documents that historical condition and `migrate.js` uses hash-based postconditions rather than relying on simple monotonic order.
- `git status --short`: clean before this artifact write.

Not run:
- `npm run typecheck --workspace=apps/web`: skipped because `typecheck:app` runs `next typegen` (`apps/web/package.json:26`), which writes generated Next type artifacts.
- `npm run build --workspace=apps/web`: skipped because `prebuild` writes generated PWA icons and `sw.js` (`apps/web/package.json:10`, `apps/web/scripts/generate-pwa-icons.ts:68-81`, `apps/web/scripts/build-sw.ts:39-43`).
- `npm test --workspace=apps/web`: skipped to preserve the "write exactly one review file" constraint; many tests are safe, but the full suite includes temp/generated-file patterns.
- `npm run test:e2e --workspace=apps/web`: skipped because the local Playwright server runs `npm run init`, `npm run e2e:seed`, and `npm run build` (`apps/web/scripts/run-e2e-server.mjs:75-84`), and the seed deletes/recreates seeded rows and files in disposable DBs (`apps/web/scripts/seed-e2e.ts:174-183`, `apps/web/scripts/seed-e2e.ts:217-230`).

## Findings

### VER-C8-01 - Real LR PAT multipart upload is still not proven end-to-end

Severity: Medium
Confidence: High
Status: risk
File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/app/api/admin/lr/upload/route.ts:528-565`, `apps/web/src/app/api/admin/lr/upload/route.ts:611`; `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:172-182`; `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7-8`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:421-431`; `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`; `apps/web/src/__tests__/admin-tokens.test.ts:181-294`.

Evidence: The production route is token-authenticated through `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` and then reads wrapper-supplied token context (`route.ts:84-92`, `route.ts:611`). Its enqueue payload correctly forwards the processing snapshot and semantic mode (`route.ts:528-565`). However, the route behavior test mocks `withAdminAuth` to an identity wrapper (`lr-upload-route-behavior.test.ts:44-47`) and directly calls `POST` with a `FormData` body (`lr-upload-route-behavior.test.ts:172-182`). The source-contract test explicitly says the route is heavy to exercise end-to-end (`lr-upload-hdr-gate.test.ts:7-8`) and locks source strings such as the enqueue payload (`lr-upload-hdr-gate.test.ts:421-431`). Token verification/scope/header defaults are tested separately with mocked DB/wrapper layers (`api-auth-response-headers.test.ts:50-149`, `admin-tokens.test.ts:181-294`).

Failure scenario: a real external publish client can fail at the integration boundary while all current tests stay green: header casing/context propagation, `markTokenUsed`, wrong-scope fallthrough, multipart parsing under the wrapper, DB insert, and queue enqueue are never proven in one request against a real token row.

Fix: add a disposable integration test that creates an admin token row with `lr:upload`, posts a real JPEG multipart request with `X-GalleryKit-Token`, asserts 2xx plus `uploaded_by`/`last_used_at`/enqueue/row state, and asserts an `lr:read` token never reaches handler work.

### VER-C8-02 - Authenticated admin/browser e2e proof remains opt-in and was not established in this lane

Severity: Medium
Confidence: High
Status: risk
File/region: `apps/web/playwright.config.ts:78-85`, `apps/web/scripts/run-e2e-server.mjs:75-84`, `apps/web/scripts/seed-e2e.ts:174-183`, `apps/web/scripts/seed-e2e.ts:217-230`, `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:28-31`, `apps/web/e2e/origin-guard.spec.ts:55-57`.

Evidence: Playwright defaults to a local server command (`playwright.config.ts:78-85`) that initializes, seeds, and builds (`run-e2e-server.mjs:75-84`). The seed is intentionally destructive unless the DB is disposable or explicitly allowed (`seed-e2e.ts:174-183`) and deletes seeded image rows/files before recreation (`seed-e2e.ts:217-230`). Authenticated admin specs are skipped unless `adminE2EEnabled` is true (`admin.spec.ts:11-13`); CI has a guard that expects credentials only when CI runs this suite (`admin.spec.ts:6-9`). The authenticated origin-guard branch has the same opt-in skip (`origin-guard.spec.ts:55-57`), while the unauthenticated smoke explicitly does not prove the origin branch (`origin-guard.spec.ts:33-53`).

Failure scenario: admin hydration, login, admin upload, topic CRUD, or authenticated cross-origin rejection can regress while read-only verifier lanes and non-admin e2e runs stay green. The test code exists, but the evidence is conditional on running against a configured disposable environment with admin credentials.

Fix: keep the destructive seeded profile, but add a separate non-destructive smoke profile for an already-provisioned disposable server, or make release verification require an explicit admin-e2e job with disposable DB credentials and record that evidence in the cycle artifact.

## Verified Non-Findings

- Admin API auth gate is active and import-source hardened: `check-api-auth.ts` only approves `withAdminAuth` imported from `@/lib/api-auth` (`apps/web/scripts/check-api-auth.ts:63-93`), and the fresh gate run passed both admin route files.
- Server action origin gate is recursive and import-source hardened: it discovers `app/actions/**` recursively plus `db-actions.ts` and `app/actions.ts` (`apps/web/scripts/check-action-origin.ts:91-113`), approves `requireSameOriginAdmin` only from `@/lib/action-guards` (`apps/web/scripts/check-action-origin.ts:50`, `apps/web/scripts/check-action-origin.ts:130-149`), and the fresh gate run passed.
- Public route rate-limit gate is active: it scans route files under `src/app`, excludes admin, requires imported pre-increment helpers or reasoned exemptions (`apps/web/scripts/check-public-route-rate-limit.ts:25-47`, `apps/web/scripts/check-public-route-rate-limit.ts:245-266`), and the fresh gate run passed 10 route files.
- Data privacy guards are symmetric: sensitive keys include GPS, originals, processing diagnostics, admin upload attribution, color/HDR admin-only fields, and processing snapshots (`apps/web/src/__tests__/privacy-fields.test.ts:7-45`); public keys are locked to an allowlist (`privacy-fields.test.ts:47-76`, `privacy-fields.test.ts:103-128`); timeline/search enrichment mirrors are also checked (`privacy-fields.test.ts:139-166`).
- Cycle-8 semantic/processing snapshot fixes are present: uploads persist `processing_settings_json` (`apps/web/src/app/actions/images.ts:487`), browser and LR enqueue all processing/semantic settings (`apps/web/src/app/actions/images.ts:527-558`, `apps/web/src/app/api/admin/lr/upload/route.ts:528-565`), retry reads strict config before clearing failed state (`apps/web/src/app/actions/images.ts:1290-1308`), and queue consumption runtime-gates stored production semantic mode (`apps/web/src/lib/image-queue.ts:184-188`).
- Restore queue lifecycle matches the plan: restore quiesces the queue (`apps/web/src/app/[locale]/admin/db-actions.ts:539-545`) and resumes it when maintenance is cleared after verified restore or pre-import failure after quiesce (`db-actions.ts:572-589`), while import/migration failures keep maintenance active (`db-actions.ts:821-845`).
- Analytics validation/index work is present: public view actions validate processed/visible targets before insert (`apps/web/src/app/actions/public.ts:436-455`, `apps/web/src/app/actions/public.ts:465-489`, `apps/web/src/app/actions/public.ts:499-527`), link-local referrer fixtures exist (`apps/web/src/__tests__/analytics.test.ts:156-158`), and top-view/retention indexes are mirrored in schema, migrations, and reconcile (`apps/web/src/db/schema.ts:238-268`, `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3`, `apps/web/drizzle/0027_analytics_retention_indexes.sql:1-3`, `apps/web/scripts/migrate.js:638-682`).
- Deploy invariants match policy: deploy refuses unsafe runtime env permissions before compose (`apps/web/deploy.sh:15-43`), waits for health before pruning (`apps/web/deploy.sh:57-77`), and prunes after health without `volume prune -a` (`apps/web/deploy.sh:79-104`). Root remote deploy env loading is config-driven and permission-checked before `source` (`scripts/deploy-remote.sh:22-84`).
- Generated service worker is current without writing files: `build-sw.ts` computes a template-hash plus pipeline version (`apps/web/scripts/build-sw.ts:27-43`), and committed `apps/web/public/sw.js:26` matches the in-memory expected `36c91deb-p7`.

## Final Sweep

Checked categories:
- Repo instructions and current docs contracts (`AGENTS.md`, `CLAUDE.md`, plan/review history).
- Lint gates and their actual pass output.
- App route inventory, admin API wrappers, server actions, public route rate limits.
- Admin flows: DB backup/restore, LR PAT upload, token actions, upload queue/retry semantics.
- Data privacy selectors and compile/runtime test guards.
- Migration journal tail, reconcile/index/foreign-key mirrors, and deploy migration postcondition architecture.
- Deployment invariants: env permissions, config-driven remote target, post-health Docker prune safety.
- Generated artifacts: service worker template/output parity; PWA icon generation source contract.
- Browser/e2e coverage shape, with destructive/mutating commands intentionally not run.

Verifier verdict: no confirmed source behavior defect was found in the inspected policy/code surfaces. The two findings are evidence risks: real PAT-authenticated LR multipart upload and authenticated admin/browser runtime behavior still require a configured disposable integration run to prove end-to-end.
