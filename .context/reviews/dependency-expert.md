# Dependency Expert Review — Cycle 1

## Scope

Reviewed the repository’s dependency manifests, framework configuration, storage abstractions, upload/serve paths, migration and seed tooling, and the active docs/plans that describe those surfaces.

Files inspected most closely:
- `README.md`
- `apps/web/README.md`
- `apps/web/package.json`
- `package-lock.json`
- `apps/web/next.config.ts`
- `apps/web/src/lib/storage/**`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/seed-e2e.ts`
- `apps/web/playwright.config.ts`
- `apps/web/playwright-test.config.ts`
- `.context/plans/**` and prior review context for cross-checking

## Verification snapshot

Executed after review:
- `npm --workspace apps/web test` ✅ 94/94 passing
- `npm --workspace apps/web run lint` ✅
- `npm --workspace apps/web run build` ✅
- `npm audit --json` → 4 moderate vulnerabilities in the dev/tooling tree
- `npm audit --omit=dev --json` → no production vulnerabilities
- `npm ls drizzle-kit esbuild @esbuild-kit/esm-loader @esbuild-kit/core-utils --depth=3` → current install tree contains a Vite/esbuild peer mismatch and invalid hoisting

Bottom line: the app is functionally green, but the dependency/documentation surface still has several truth gaps and one real dependency hygiene problem in the current install tree.

---

## Ranked findings

| Rank | Area | Severity | Confidence | Summary |
|------|------|----------|------------|---------|
| 1 | Vite/Vitest install tree | Medium | High | The lockfile currently resolves `vite@8.0.8` against an invalid `esbuild@0.18.20` peer, so the dev toolchain is not internally consistent. |
| 2 | Dev dependency security | Medium | High | `drizzle-kit` still pulls the deprecated `@esbuild-kit/*` chain and `npm audit` reports a moderate esbuild advisory in the tooling path. |
| 3 | Storage abstraction | Low/Medium | High | The repo documents a storage backend switch, but the live upload/serve path still uses direct filesystem I/O and the S3 backend buffers whole files in memory. |
| 4 | Private-originals contract | Medium | High | Docs say originals live in the private data volume, but E2E seeding and legacy path handling still write/accept originals under `public/uploads/original`. |
| 5 | Restore size contract | Low/Medium | Medium | The admin restore limit comment says it should track the framework body limit, but the framework limit is 2 GiB while restore rejects files above 250 MB. |

---

## 1) Vite/Vitest install tree is internally inconsistent

**Severity:** Medium  
**Confidence:** High

### Evidence
- `apps/web/package.json:57-73` pulls in `@vitejs/plugin-react`, `vitest`, `tsx`, and the rest of the Vite-based dev stack.
- `package-lock.json:125-155` records `vite@8.0.8` with a peer requirement of `esbuild ^0.27.0 || ^0.28.0`.
- `package-lock.json:7980-8016` records the hoisted root `esbuild` as `0.18.20`.
- `npm ls ...` reports `esbuild@0.18.20 invalid` for the Vite peer range.

### Failure scenario
A clean reinstall, CI refresh, or another Vite-based workflow can resolve the tree differently than the current checkout. That makes the current install non-reproducible and leaves a latent failure mode for any tool that expects Vite 8’s esbuild peer contract.

### Fix suggestion
Refresh the lockfile so the hoisted `esbuild` satisfies Vite 8’s peer range, or pin the Vite/Vitest toolchain to a compatible set and regenerate the workspace install.

---

## 2) `drizzle-kit` still carries a deprecated/esbuild advisory chain

**Severity:** Medium  
**Confidence:** High

### Evidence
- `apps/web/package.json:65-66` declares `drizzle-kit` as a dev dependency.
- `package-lock.json:1388-1410` shows `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` are deprecated (“Merged into tsx”) and that `core-utils` depends on `esbuild ~0.18.20`.
- `package-lock.json:7200-7210` shows `drizzle-kit@0.31.10` still depends on `@esbuild-kit/esm-loader` and `esbuild ^0.25.4`.
- `npm audit --json` reports 4 moderate vulnerabilities total, including the `drizzle-kit` / `@esbuild-kit/*` / `esbuild` chain and GHSA-67mh-4wv8-2f99.

### Failure scenario
Developers running `db:push`, `init`, or migration tooling are carrying a known esbuild advisory in the local toolchain. The impact is mostly developer-facing, but it widens the attack surface of any local dev server that gets exposed to an untrusted network path.

### Fix suggestion
Upgrade or replace the migration toolchain so it no longer pulls the deprecated `@esbuild-kit/*` path, then re-run `npm audit` and `npm ls` to confirm the tree is clean.

---

## 3) The storage backend abstraction is documented as active, but the app still runs on direct filesystem I/O

**Severity:** Low/Medium  
**Confidence:** High

### Evidence
- `apps/web/src/lib/storage/index.ts:1-13` says the backend switches via a `storage_backend` admin setting, but the same module explicitly notes that upload/processing/serving are not yet integrated.
- `apps/web/src/lib/storage/index.ts:116-177` only swaps an in-memory singleton; there is no call site in the actual upload/serve pipeline.
- `apps/web/src/lib/process-image.ts:225-230` writes originals directly to disk with `fs`/`pipeline`.
- `apps/web/src/lib/serve-upload.ts:32-40,63-76` serves uploads directly from the filesystem.
- `apps/web/src/lib/storage/s3.ts:95-105` turns `writeStream` into a full `Buffer.concat(...)` before `PutObjectCommand`.
- `apps/web/src/lib/storage/s3.ts:182-185` deletes keys one-by-one instead of using S3 batch delete.

### Failure scenario
An operator reads the storage abstraction and assumes MinIO/S3 support is ready. In reality, uploads and serving still hit the local filesystem. If someone later wires the abstraction in without revisiting the S3 implementation, large uploads can spike heap usage and deletions will be request-heavy.

### Fix suggestion
Either remove/gate the abstraction until it is end-to-end, or finish the integration with real streaming multipart uploads, batch delete semantics, and an integration test that exercises the entire backend swap.

### External reference
- AWS S3 GetObject/streaming types: https://docs.aws.amazon.com/de_de/sdk-for-javascript/v3/developer-guide/creating-and-calling-service-objects.html
- AWS S3 multi-object delete: https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html

---

## 4) The private-originals contract is still broken by legacy path handling and E2E seeding

**Severity:** Medium  
**Confidence:** High

### Evidence
- `README.md:137-149` says new original uploads are kept in the private data volume.
- `apps/web/src/lib/upload-paths.ts:11-37` defines a private `UPLOAD_ORIGINAL_ROOT`, but also keeps `LEGACY_UPLOAD_DIR_ORIGINAL` under `public/uploads/original`.
- `apps/web/src/lib/upload-paths.ts:48-70` still searches and deletes both private and legacy public-original locations.
- `apps/web/scripts/migrate.js:35-75` exists to move legacy originals out of the public web root.
- `apps/web/scripts/seed-e2e.ts:50-97` still writes seeded originals and derivatives into `public/uploads/*`, including `public/uploads/original`.

### Failure scenario
Seeded local/staging environments can still populate `public/uploads/original`, which contradicts the documented privacy model and makes the boundary look stronger than it really is. That can hide regressions in privacy-sensitive deployments because the system still accepts the legacy public-original path.

### Fix suggestion
Make all tooling write through `UPLOAD_ORIGINAL_ROOT` and stop seeding `public/uploads/original`. If the legacy path must remain temporarily, keep it behind a one-time migration only and make the docs explicit that it is transitional.

### External reference
- Root README deployment and storage notes: `README.md:137-149`

---

## 5) The restore upload cap does not actually match the framework limit it claims to track

**Severity:** Low/Medium  
**Confidence:** Medium

### Evidence
- `apps/web/next.config.ts:96-101` sets `serverActions.bodySizeLimit` and `proxyClientMaxBodySize` from `NEXT_UPLOAD_BODY_SIZE_LIMIT`.
- `apps/web/src/lib/upload-limits.ts:1-22` derives that framework limit from `UPLOAD_MAX_TOTAL_BYTES`, with a default of 2 GiB.
- `apps/web/src/app/[locale]/admin/db-actions.ts:224-227` says the restore limit should stay in sync with `next.config.ts`’s body size limit.
- `apps/web/src/app/[locale]/admin/db-actions.ts:270-272` still enforces a separate `MAX_RESTORE_SIZE = 250 MB`.

### Failure scenario
A restore file bigger than 250 MB but smaller than the framework body limit will still be fully parsed by Next.js and only then rejected by the action. That wastes request bandwidth/heap and gives operators the wrong impression that the framework cap is the actual restore cap.

### Fix suggestion
Either align the framework body limit with the restore limit, or update the comment/docs so operators know the restore action is intentionally stricter than the framework limit.

### External reference
- Next.js `serverActions.bodySizeLimit`: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- Next.js `proxyClientMaxBodySize`: https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize

---

## Additional stale surface worth tracking

### Legacy Playwright config drift
- `apps/web/package.json:18-20` wires E2E through `playwright test` and not the alternate config file.
- `apps/web/playwright.config.ts:1-58` is the active config.
- `apps/web/playwright-test.config.ts:1-22` appears to be a manual/legacy config that no script references.

This is not a blocker, but it is a dead surface that can drift silently if someone keeps editing it as though it were part of the normal E2E path.

---

## Closing notes

The repo is healthy on the basics: unit tests, lint, and production build all pass. The remaining issues are mostly around dependency hygiene and truth alignment:

1. the dev toolchain is not fully internally consistent,
2. `drizzle-kit` still carries a known esbuild advisory chain,
3. the storage abstraction is more aspirational than real,
4. the privacy story around originals is still partially transitional, and
5. the restore/upload size comments do not match the real runtime cap.

Those are the places I would fix or de-risk first.
