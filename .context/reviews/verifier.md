# Cycle 32 Verifier Review

Role: verifier lane
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `3d174c96`
Date: 2026-06-30
Scope: evidence-check stated repo behavior against implementation and tests. Product code was not edited.

## Inventory

Required docs read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Behavior contracts inventoried:

- Auth/session/admin API: Argon2id login, HMAC session token shape, middleware admin cookie guard, `withAdminAuth(...)`, same-origin server-action guard, admin token route scope.
- Public/privacy: `publicSelectFields`, `_PrivacySensitiveKeys`, public map GPS exception, search enrichment fields, public photo data path.
- Migration/deploy: Drizzle non-monotonic journal handling, post-condition hash assertion, deploy health check and Docker prune ordering.
- Color/HDR: default HDR ingest rejection, LR upload parity, admin-only HDR/source audit columns, public HDR honesty rule, delivered color metadata.
- Semantic search: disabled default, production env gate, model-version separation, similar-search production-only gate, backfill `--production` guard.
- Rate limits: admin API token attempts, login attempts, public mutating actions, public expensive API GETs, semantic routes.
- UI policies: 44 px touch target floor, shadcn button variant floor, source scanner coverage.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` passed; reported both admin API routes wrapped: `api/admin/db/download` and `api/admin/lr/upload`.
- `npm run lint:action-origin --workspace=apps/web` passed; reported all mutating admin actions OK and public exempt actions rate-limited where required.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed; reported OK for health, live, OG, semantic, and similar routes.
- Targeted Vitest passed: `npm test --workspace=apps/web -- src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/map-privacy.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/gallery-config-semantic-production.test.ts src/__tests__/semantic-search-mode-validator.test.ts src/__tests__/similar-route.test.ts src/__tests__/clip-semantic-integration.test.ts src/__tests__/images-actions.test.ts src/__tests__/lr-upload-hdr-gate.test.ts src/__tests__/color-details-section-delivered.test.ts src/__tests__/lightbox-color-pip-hdr.test.ts src/__tests__/touch-target-audit.test.ts` -> 18 passed, 1 skipped, 342 passed tests, 2 skipped tests.

## Findings

### VER32-01 - Lightbox color pip still renders admin-only transfer function outside the `isAdmin` gate

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/components/lightbox-color-pip.tsx:44-84`, `apps/web/src/components/lightbox-color-pip.tsx:161-185`; missing coverage in `apps/web/src/__tests__/lightbox-color-pip-hdr.test.ts:208-220`.
- Stated contract: CLAUDE says `is_hdr` / `transfer_function` / `matrix_coefficients` are admin-only so public viewers never see HDR/source metadata whose delivered bytes do not fulfill it (`CLAUDE.md:300-302`). The field contract lists `transfer_function` as admin-only (`CLAUDE.md:163-177`), and the component comment says `transfer_function` / `color_pipeline_decision` are gated on `isAdmin` to protect a future call site that passes admin-fetched data with `isAdmin={false}` (`lightbox-color-pip.tsx:45-50`).
- Implementation evidence: the component only applies `isAdmin` in the `hasData` gate (`lightbox-color-pip.tsx:51`) and the expanded transfer row (`lightbox-color-pip.tsx:202-207`). It still computes `const transfer = humanizeTransferFunction(image.transfer_function, t)` unconditionally (`lightbox-color-pip.tsx:65-67`), includes that value in the public button `aria-label` (`lightbox-color-pip.tsx:169-176`), and visibly renders `· {transfer}` in the collapsed pip (`lightbox-color-pip.tsx:184`).
- Concrete failure scenario: a future public or shared viewer reuses an admin-fetched image object containing `color_primaries='bt2020'` and `transfer_function='pq'` but passes `isAdmin={false}`. `hasData` is true because `color_primaries` is public; the closed lightbox pip then exposes the admin-only transfer function text and screen-reader label even though the expanded transfer row and copy payload are correctly gated.
- Why this is not an active canonical public leak today: the public photo page loads `getImageCached(imageId)` and passes `isAdmin={isAdminUser}` (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143-150`, `277-292`); `getImage()` selects `...publicSelectFields` (`apps/web/src/lib/data.ts:1049-1055`); `publicSelectFields` omits `transfer_function` and the `_PrivacySensitiveKeys` guard includes it (`apps/web/src/lib/data.ts:368-408`, `459-476`).
- Test gap: `lightbox-color-pip-hdr.test.ts` locks only the `hasData` short-circuit admin gate (`lightbox-color-pip-hdr.test.ts:208-220`) and HDR badge admin gate (`lightbox-color-pip-hdr.test.ts:107-114`). It does not assert that the collapsed transfer label/aria text is also `isAdmin`-gated, so the targeted Vitest run passes with this mismatch.

## Verified Behaviors

- Auth invariants matched docs. Login checks same-origin before expensive verifier work, pre-increments IP and account rate-limit buckets before Argon2 verification, and uses the shared Argon2id policy (`apps/web/src/app/actions/auth.ts:95-148`, `168-180`; `apps/web/src/lib/password-hashing.ts:10-15`). Sessions are HMAC-signed, DB-stored as SHA-256 token hashes, require `SESSION_SECRET` in production, and use timing-safe signature comparison (`apps/web/src/lib/session.ts:8-35`, `82-150`). Admin API wrappers check token scope first for PAT clients, then same-origin + `isAdmin()` for cookie clients, and add no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:68-143`). Middleware rejects malformed admin cookies before protected admin routes (`apps/web/src/proxy.ts:65-105`). The auth and action-origin gates passed.
- Public/privacy contracts matched the data layer. `publicSelectFields` explicitly omits GPS, original/user filenames, processing internals, and color/HDR admin fields (`apps/web/src/lib/data.ts:368-408`). `publicMapSelectFields` is the only GPS exception and is documented as requiring the `map_visible` filter (`apps/web/src/lib/data.ts:410-445`). Compile-time guards cover public and map selects (`apps/web/src/lib/data.ts:459-489`), with runtime/test mirrors in `privacy-fields`, `map-privacy`, and `search-route-privacy`; targeted tests passed.
- Migration/deploy rules matched implementation and tests. The migration helper baselines one row per journal entry to avoid Drizzle's `MAX(created_at)` skip behavior, reconciles fresh and legacy DBs, and fails if any committed journal hash is missing after migrate (`apps/web/scripts/migrate.js:720-818`). Deploy waits for the web container health check before pruning and uses `docker volume prune -f` without `-a` after documenting bind-mounted persistence (`apps/web/deploy.sh:30-83`). Migration/deploy targeted tests passed.
- Semantic search gates matched docs. `semantic_search_mode='production'` is valid but resolves to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/src/lib/gallery-config-shared.ts:159-211`; `apps/web/src/lib/gallery-config.ts:123-126`). Text semantic search rate-limits before config/body work and uses `PRODUCTION_MODEL_VERSION` or `STUB_MODEL_VERSION` by mode (`apps/web/src/app/api/search/semantic/route.ts:173-204`). Similar search is production-only and queries the target embedding at `PRODUCTION_MODEL_VERSION` (`apps/web/src/app/api/search/similar/[id]/route.ts:98-145`). The production backfill refuses `--production` without the env opt-in (`apps/web/scripts/backfill-clip-embeddings.ts:100-128`). Route/config tests passed; the real CLIP integration suite was skipped unless `CLIP_INTEGRATION=1`, so this lane did not prove live model weights or deployed row counts.
- Color/HDR ingest gates matched the stated default. Browser upload rejects HDR when `allowHdrIngest` is false and records a specific `hdrNotSupported` all-HDR failure (`apps/web/src/app/actions/images.ts:360-371`, `574-581`); LR upload mirrors the same gate before insert (`apps/web/src/app/api/admin/lr/upload/route.ts:348-365`). Both paths persist HDR/source audit columns only as admin data (`apps/web/src/app/actions/images.ts:440-448`; `apps/web/src/app/api/admin/lr/upload/route.ts:439`). Targeted HDR tests passed.
- UI policy proof matched the scanner contract. The button primitive floors default/sm/icon variants at 44 px or greater (`apps/web/src/components/ui/button.tsx:23-30`). The touch-target audit scans components, admin route group, public route group, and app-level route files (`apps/web/src/__tests__/touch-target-audit.test.ts:42-83`) with forbidden patterns for sub-44 Button/button/select/Link/a/input shapes (`touch-target-audit.test.ts:247-523`). The targeted touch-target test passed.

## Final Sweep

Final sweep covered stated docs, auth/session/admin wrappers, public select sets and GPS map exception, public photo/lightbox call path, color/HDR components, LR/browser ingest paths, semantic search routes/config/backfill, migration/deploy scripts, public route scanners, and targeted invariant tests. No code files or other review files were edited. The only changed file from this lane is `.context/reviews/verifier.md`.
