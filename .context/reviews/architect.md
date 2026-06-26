# Architect Review — Cycle 14 (R14C14)

**Agent:** architect (opus) · **HEAD:** 39cfa889 · **Angle:** coupling/layering, client/server boundary, config drift, dead-code wiring, missing seams that let a known bug class recur.

**Bottom line:** Cycle-13's `exec`/SIGTERM fix is correctly in place and the shutdown drain is complete (only one module-level buffer exists and it is flushed). No CRITICAL/HIGH/MEDIUM new architectural risk. Two new cheap seam-completeness issues (LOW), one INFO config asymmetry, plus updated-priority notes on already-deferred structural debt.

## Severity table
| ID | Sev | Type | File(s) | Confidence |
|----|-----|------|---------|------------|
| A14-01 | LOW | Missing seam / boundary completeness | `src/__tests__/client-server-only-boundary.test.ts:263-268`, `src/lib/password-hashing.ts:1`, `scripts/migrate-admin-auth.ts:10` | High |
| A14-02 | LOW/INFO | Dead-code accidental-wiring guard | `src/lib/storage/*`, only importer `src/__tests__/storage-local.test.ts:10` | High |
| A14-03 | INFO | Config asymmetry (defense-in-depth) | `apps/web/nginx/default.conf:163-165` | High |

## A14-01 — LOW — `argon2` native import invisible to the client→server-only boundary guard
`src/lib/password-hashing.ts:1` does `import * as argon2 from 'argon2'`. The boundary test's native-module allowlist (`hasNativeModuleImport`, `client-server-only-boundary.test.ts:263-268`) recognizes only `sharp`/`@huggingface/transformers`; `mysql2` is handled separately. `argon2` is in neither list and not in `serverExternalPackages`. `password-hashing.ts` is in exactly the bucket the boundary test treats as server-only-equivalent (operator tsx scripts `migrate-admin-auth.ts:10` / `seed-admin.ts` import it, so it cannot carry `import 'server-only'`), yet its native-addon signal was never added.
**Failure:** a future `'use client'` component value-importing `@/lib/password-hashing` (e.g. to reuse `PASSWORD_HASH_OPTIONS`) pulls native `argon2` into the browser bundle; the fast boundary test passes GREEN and the regression only surfaces as an opaque webpack native-binding error in full `next build`.
**Fix (test-only, cheap):** add `argon2` to the `hasNativeModuleImport` alternation + a pin asserting `password-hashing.ts` is recognized server-only-equivalent (mirrors the `@/db`/`clip-model.ts` pins).

## A14-02 — LOW/INFO — `lib/storage` quarantine relies on discipline, not an automated guard
`src/lib/storage/{index,local,types}.ts` has zero production importers (only `storage-local.test.ts:10`). `index.ts` exports a working `getStorage()` returning `LocalStorageBackend`, so a future action doing `import { getStorage } from '@/lib/storage'` would compile and "work", silently establishing a second, unaudited write path parallel to `uploadImages`/`process-image` (diverging on path-traversal/symlink hardening, ETag/settings-hash invalidation, GPS-strip). CLAUDE.md quarantines it by prose only; nothing in CI fails.
**Fix (cheap point-guard):** a fixture asserting no file outside `src/lib/storage/` and `src/__tests__/` statically imports `@/lib/storage` (re-use the AST-import-scan helpers from `client-server-only-boundary.test.ts`). Re-open/delete criterion: storage backend intentionally wired into the upload/serve pipeline. **This is an UPDATE to the deferred "lib/storage quarantine" item — add the cheap guard now, NOT the integration.**

## A14-03 — INFO — nginx `/uploads/original/` 404 is non-locale-only
`nginx/default.conf:163` `location ^~ /uploads/original/ { return 404; }` is a literal prefix; `/{locale}/uploads/original/...` falls through to `location /` and is proxied to Next. No leak: `serveUploadFile` rejects any `topLevelDir` not in `{jpeg,webp,avif}` (`serve-upload.ts:138-140`) + realpath containment. Recorded so the asymmetry isn't mistaken for a gap; optional one-liner adds the `(?:/[a-z]{2})?` locale prefix for edge symmetry.

## Updated-priority notes on already-DEFERRED structural debt
- **`lib/storage/*` quarantine:** promote to "add the A14-02 cheap import-guard now" (independent of the integration).
- **Shutdown-hook registry:** urgency DOWNGRADE confirmed — `viewCountBuffer` (`data.ts:17`) is the only module-level durable-ish buffer and it IS flushed (`instrumentation.ts:35-39`). Other in-memory Maps are ephemeral rate/quota state, correctly not flushed. Registry remains a clarity refactor, not a correctness need. (NOTE: the cycle-14 R14-01 flush-race and C14-01 Next-handler findings are about the flush MECHANISM, not a missing sibling buffer.)
- **`data.ts`/`processImageFormats`/`uploadImages` god-modules:** unchanged; repo defers by policy.
- **Single-web-instance topology (BY DESIGN):** not re-litigated.

## Verified-CLEAN (probed this cycle)
- Docker SIGTERM/`exec` correct post-cycle-13 (`Dockerfile:130`, `entrypoint.sh:39`); `stop_grace_period 30s` > 15 s shutdown sentinel.
- Client/server boundary: only client imports of `@/lib/data` (`home-client.tsx:13`, `load-more.tsx:6`) are `import type` (erased); enforced by the AST closure-walk test (modulo A14-01).
- `'use server'` grep hits in `csv-escape.ts`/`bulk-edit-types.ts` are comments only.
- Cache-policy 3-way alignment; nginx body caps vs CLAUDE.md aligned; COLOR_IMPACTING_KEYS=9.
- Removed paid-downloads (migration 0023): `reconcileLegacySchema` actively drops `entitlements` + `images.license_tier`, locked by tests. Exemplary.
- Suppression hygiene: one well-commented geoip-lite dynamic-require `eslint-disable` only.
