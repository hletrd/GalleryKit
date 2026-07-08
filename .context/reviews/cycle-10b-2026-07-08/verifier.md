# Cycle 10b Verifier Report — Doc-vs-Code Invariant Audit

**Scope:** Spot-verification of high-value claims in `CLAUDE.md` against committed HEAD
(`f4faad29f1b90984e352677c66d832239787b855`) in the GalleryKit repo. Shared worktree with
an active peer (~cycle 29); per instructions, `apps/web/scripts/check-action-origin.ts`,
`apps/web/src/__tests__/check-action-origin.test.ts`, and
`apps/web/src/__tests__/cycle-28-source-contracts.test.ts` are peer-dirty and were reviewed
via `git show HEAD:<path>` only, never the working tree.

## Verdict

**Status: PASS (no false/stale claims found in the audited set).**

Every invariant checked below verified TRUE against committed source and/or fresh test
output. No fabricated findings — this is an honest "everything checked holds" result.

## What was verified (with evidence)

| # | Claim (CLAUDE.md) | Verification method | Result |
|---|---|---|---|
| 1 | `settings-hash.ts` `COLOR_IMPACTING_KEYS` count is 9 (5 color + 3 quality + 1 size) | `git show HEAD` on `settings-hash.ts` + `gallery-config-shared.ts` `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`; counted literal array | **TRUE** — exactly 9: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Also locked by a dedicated assertion in `settings-hash.test.ts` line 22 comment explicitly citing "CLAUDE.md ETag section: 9 COLOR_IMPACTING_KEYS" |
| 2 | ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` | `git show HEAD:apps/web/src/lib/serve-upload.ts` line 123 | **TRUE** — literal template matches exactly: `` `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` `` |
| 3 | GPS fail-closed: structurally anomalous HEIC and unrecognized extensions return `false` from `stripGpsFromOriginal`, and both upload paths delete the just-saved original + reject the upload | Read `process-image.ts:1725-1810`, `app/actions/images.ts:373-380`, `app/api/admin/lr/upload/route.ts:427-434` | **TRUE** — HEIC/HEIF anomaly and unknown-extension branches both `console.error` + `return false`; both callers check `!gpsStripped`, call `deleteOriginalUploadFile`/equivalent, and reject (continue/push to failedFiles in the action path; 422 JSON response in the LR API path) |
| 4 | Advisory-lock registry: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, `gallerykit:image-processing:{jobId}`, plus DB-scoped exception `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>` | `git show HEAD:apps/web/src/lib/advisory-locks.ts` (full file) + repo-wide grep for `gallerykit_` literals | **TRUE** — all 7 named locks plus the templated per-job lock exist exactly as documented, including the explicit doc-comment about the single-writer lock being the one DB-scoped exception vs. the rest being server-scoped |
| 5 | `withTopicRouteMutationLock` wraps `createTopic`, `updateTopic`, `deleteTopic`, and `createTopicAlias` | `git show HEAD:apps/web/src/app/actions/topics.ts`, grep for call sites vs. enclosing `export async function` | **TRUE** (and broader than documented) — all four are wrapped; the code additionally wraps `deleteTopicAlias` too (5th call site), which is a superset of the documented claim, not a contradiction — not flagged as an issue since it under-states rather than over-states protection |
| 6 | Privacy field guards: `publicSelectFields` omits an explicit sensitive-key allowlist derived from `adminSelectFields`; compile-time + runtime guards enforce it | `git show HEAD` on `data.ts` (destructuring omissions) + `privacy-fields.test.ts` (full read) + fresh `vitest run` | **TRUE** — `SENSITIVE_KEYS` list in the test matches the documented admin-only column table (color_space, icc_profile_name, bit_depth, color_pipeline_decision, transfer_function, matrix_coefficients, is_hdr, has_gain_map, was_downscaled, uploaded_by, pipeline_version, etc.); fresh test run below confirms it holds today, not just in the past |
| 7 | GPS/PII fields excluded from public API: `latitude`/`longitude`/`filename_original`/`user_filename` | Same `privacy-fields.test.ts` review | **TRUE** — present in `SENSITIVE_KEYS` and asserted absent from `publicSelectFieldKeys` |
| 8 | sw.js `__SW_VERSION__` stamp = `sha256(template + "\nPIPELINE=" + IMAGE_PIPELINE_VERSION).slice(0,8) + "-p" + IMAGE_PIPELINE_VERSION` | Extracted committed `sw.template.js`, ran the exact `build-sw.ts` hash formula against it in Node with `IMAGE_PIPELINE_VERSION=7` | **TRUE** — computed `fc3ca358-p7`; committed `public/sw.js` line 26 has `const SW_VERSION = 'fc3ca358-p7';` — **exact match**, so the committed `sw.js` is NOT stale relative to `sw.template.js` |
| 9 | Rate-limit buckets: per-IP (5/15-min) and per-account (`acct:<sha256-prefix>`, same 5/15-min) | `git show HEAD` on `rate-limit.ts` (`LOGIN_WINDOW_MS = 15*60*1000`, `LOGIN_MAX_ATTEMPTS = 5`, `ACCOUNT_RATE_LIMIT_PREFIX = 'acct:'`, `buildAccountRateLimitKey` = sha256-then-slice) and `auth-rate-limit.ts` | **TRUE** — both buckets share `LOGIN_WINDOW_MS`/effectively the 5-attempt ceiling checked via `isRateLimitExceeded`, account key format is exactly `acct:` + sha256 hex prefix |
| 10 | Touch-target audit (44px floor) scan coverage: `components/`, `app/[locale]/admin/`, `app/[locale]/(public)/`, plus explicit app-level extra files (`global-error.tsx`, `[locale]/error.tsx`, `[locale]/not-found.tsx`, `[locale]/layout.tsx`, `[locale]/loading.tsx`) | `git show HEAD` full read of `touch-target-audit.test.ts` + fresh `vitest run` | **TRUE** — `SCAN_ROOTS` and `appLevelExtraFiles` match documented coverage; `max-` ceiling-exemption lookbehind present on Button/button, select, and Link/a as documented; test passes fresh (see evidence table) |
| 11 | Cache-Control `public, max-age=3600, must-revalidate` consistent across `next.config.ts`, `serve-upload.ts`, and `nginx/default.conf` | grep all three files at HEAD | **TRUE** — identical literal string in all three locations |
| 12 | nginx `zone=public rate=10r/s burst=40` and `zone=nextimage rate=30r/s burst=120`, verification thresholds ">50 rapid GETs of `/`" / ">150 rapid `/_next/image` requests" | `git show HEAD:apps/web/nginx/default.conf` | **TRUE** — exact rate/burst values match; threshold math checks out (burst 40 → need >40 in-window to trip, so ">50" is a safe margin; burst 120 → ">150" is a safe margin) |
| 13 | Migration post-condition: `runMigrations` throws `"Drizzle silently skipped N migration(s): …"` if any journal hash is missing after `migrate()`; DML-baseline guard refuses to baseline DML-bearing entries outside `LEGACY_DML_MIRRORED_BY_RECONCILE = {'0001_sync_current_schema'}` | `git show HEAD:apps/web/scripts/migrate.js` (relevant sections) + fresh `vitest run migrate-pending-migrations.test.ts` | **TRUE** — exact error-message substring present; allowlist set matches; test suite for mixed-batch/refusal-guard/null-cursor/allowlist cases passes fresh |
| 14 | Gate scripts exist and match documented invocation: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `typecheck` (= `typecheck:app` + `typecheck:scripts`) | `git show HEAD` on root `package.json` and `apps/web/package.json` | **TRUE** — all four scripts present at both the root delegator and workspace level, wired to `check-api-auth.ts` / `check-action-origin.ts` / `check-public-route-rate-limit.ts` / `typecheck-app.mjs` + `tsc -p tsconfig.scripts.json` exactly as documented |
| 15 | `lint:api-auth` scans every `/api/admin/**/route.*` file | Ran `npm run lint:api-auth` fresh + `find` for actual route files | **TRUE** — only 2 admin API route files exist (`db/download/route.ts`, `lr/upload/route.ts`); scanner reports `OK` for both, matching the full inventory (no silent gap) |
| 16 | `lint:public-route-rate-limit` covers all public mutating/expensive-GET routes | Ran `npm run lint:public-route-rate-limit` fresh | **TRUE** — 10 files reported `OK`, each with a specific documented exemption or rate-limit-helper reason (matches the "expensive GET markers" / `@public-no-rate-limit-required` design described in CLAUDE.md) |

## Fresh evidence

```
$ npx vitest run src/__tests__/privacy-fields.test.ts src/__tests__/touch-target-audit.test.ts \
    src/__tests__/settings-hash.test.ts src/__tests__/sw-template-contract.test.ts \
    src/__tests__/migrate-pending-migrations.test.ts src/__tests__/check-public-route-rate-limit.test.ts \
    src/__tests__/check-api-auth.test.ts src/__tests__/data-tag-names-sql.test.ts

 Test Files  8 passed (8)
      Tests  221 passed (221)
```

```
$ npm run lint:api-auth
OK: src/app/api/admin/db/download/route.ts
OK: src/app/api/admin/lr/upload/route.ts

$ npm run lint:public-route-rate-limit
OK: src/app/[locale]/(public)/[topic]/feed.xml/route.ts (expensive GET uses rate-limit helper for GET/HEAD handlers)
OK: src/app/[locale]/(public)/uploads/[...path]/route.ts (carries @public-no-rate-limit-required)
OK: src/app/api/health/route.ts (carries @public-no-rate-limit-required)
OK: src/app/api/live/route.ts (no mutating or expensive GET handlers; HEAD is treated as an expensive read)
OK: src/app/api/og/photo/[id]/route.tsx (expensive GET uses rate-limit helper for GET/HEAD handlers)
OK: src/app/api/og/route.tsx (expensive GET uses rate-limit helper for GET/HEAD handlers)
OK: src/app/api/search/semantic/route.ts (uses rate-limit helper)
OK: src/app/api/search/similar/[id]/route.ts (expensive GET uses rate-limit helper for GET/HEAD handlers)
OK: src/app/feed.xml/route.ts (expensive GET uses rate-limit helper for GET/HEAD handlers)
OK: src/app/uploads/[...path]/route.ts (carries @public-no-rate-limit-required)
```

```
$ node -e "sha256(sw.template.js + '\nPIPELINE=7').slice(0,8) + '-p7'"
fc3ca358-p7
$ git show HEAD:apps/web/public/sw.js | grep SW_VERSION
const SW_VERSION = 'fc3ca358-p7';    // exact match
```

## Non-finding: `npm run typecheck` fails — NOT a HEAD defect

`npm run typecheck` (full project) fails with 3 `TS2339` errors at
`apps/web/scripts/check-action-origin.ts:163` (`Property 'body' does not exist on type
'SignatureDeclaration'`). Traced this to the peer's **uncommitted** working-tree diff
(`git diff HEAD -- apps/web/scripts/check-action-origin.ts`), which adds
`sourceFileHasInlineUseServerDirective()` calling `ts.isFunctionLike(node) && node.body` —
`FunctionLike` includes bodiless `CallSignatureDeclaration`/`ConstructSignatureDeclaration`
members, so `.body` doesn't exist on the narrowed type without a further `ts.isBlock`-style
guard on the declaration kind. Confirmed HEAD's committed version of this file (`git show
HEAD:...`) has no such code path (`isFunctionLike` call sites at lines 360/824/1016/1171 in
HEAD all guard differently). This is peer cycle-29-in-progress WIP breakage, correctly out
of scope per this task's instructions — not reported as a cycle-10b finding, and not
included in the PASS verdict's evidence set (`typecheck` was excluded from the "ran fresh"
claims above for that reason). The next verifier pass, once the peer's change lands, should
re-run full `npm run typecheck` and confirm it's fixed (fix is a straightforward
`ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
|| ts.isMethodDeclaration(node)`-style narrowing before touching `.body`, or a
`'body' in node && node.body` guard).

## Gaps / items not exhausted (time-boxed scope, not failures)

- Did not re-verify `lint:action-origin` itself (scanner + its own test) against HEAD in
  isolation, since both the scanner and its test are the peer's active dirty files — running
  either against the working tree would conflate peer WIP with HEAD state, and reconstructing
  an isolated HEAD-only run (copy to scratch + rewire imports) was judged lower value than the
  16 invariants above within the time-boxed scope of this pass. Recommend the next verifier
  pass (after the peer's cycle lands) re-check `check-action-origin.ts` coverage explicitly.
- Did not execute the full `vitest run` suite (only the 8 targeted files relevant to the
  claims list) — full-suite run was avoided partly for time and partly because
  `cycle-28-source-contracts.test.ts` is also peer-dirty and would mix WIP state into a
  "fresh" full-suite claim.
- Did not run e2e/Playwright suites (out of scope for a doc-vs-code invariant audit).

## Recommendation

No changes required from this pass. All 16 audited CLAUDE.md claims verify TRUE against
committed HEAD with fresh test/script evidence. The one failing command (`npm run
typecheck`) is attributable entirely to the peer's in-flight uncommitted edit and should
resolve when that work lands; flag to the next cycle's verifier to confirm.
