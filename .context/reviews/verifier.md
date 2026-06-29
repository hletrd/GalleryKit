# Verifier Review - Cycle 12

Date: 2026-06-29
Role: verifier, evidence-based correctness check against stated behavior in docs/tests
Scope: `/Users/hletrd/flash-shared/gallery` on `master` at `d0e75c49`
Constraint: review artifact only. No production code edited.

## Inventory

Reviewed the repo surfaces that carry explicit behavior claims:

- Governing docs/contracts: `AGENTS.md` from the prompt, `CLAUDE.md`, root `README.md`, root `package.json`, `apps/web/package.json`.
- Runtime/deploy/config: `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Routes/actions: every committed `apps/web/src/app/**/route.{ts,tsx}` file, public pages under `app/[locale]/(public)`, all server actions under `apps/web/src/app/actions/`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Core libraries: auth/session/API token helpers, `rate-limit.ts`, `request-origin.ts`, `data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `image-queue.ts`, `process-image.ts`, `serve-upload.ts`, `gallery-config*.ts`, `settings-hash.ts`, upload/restore/backup helpers, Atom feed helpers.
- Schema/migrations: `apps/web/src/db/schema.ts`, all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Tests/contracts sampled: auth/origin/rate-limit scanners, privacy and feed tests, backup download tests, resolved-stream source-contract tests, LR upload source contracts, share-route source contracts, migration coverage, semantic/similar search, and OG fallback/source contracts.

Skipped as non-source review inputs: `node_modules/`, `.next/`, screenshots/binary fixtures, local `.env*`, and generated test-result artifacts.

## Findings

### LOW / Confirmed / High Confidence - Atom attribution comments and a privacy test assert stale feed behavior

**Evidence**

- Correct current behavior: `getImagesForFeed()` intentionally selects `author_name: sql<string | null>\`NULL\`` and documents that public Atom must not expose admin usernames, falling back to feed-level author until a safe display-name column exists (`apps/web/src/lib/data.ts:833-845`).
- Both feed routes implement that fallback by only emitting `perEntryAuthor` when `img.author_name` is a non-empty string different from `seo.author` (`apps/web/src/app/feed.xml/route.ts:76-82`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`).
- `CLAUDE.md` agrees: `uploaded_by` is admin-only and "public Atom currently uses the feed-level author until a safe public display-name field exists" (`CLAUDE.md:171`).
- Stale assumptions remain:
  - `apps/web/src/__tests__/privacy-fields.test.ts:28-30` says per-entry Atom `<author>` uses a JOIN-derived display name in `getImagesForFeed`.
  - `apps/web/src/app/actions/images.ts:435-438` says the public feed renders a JOIN-derived display name when storing `uploaded_by`.

**Failure scenario**

A future maintainer changing `uploaded_by` or feed attribution can trust the test/comment wording and reintroduce an admin-user JOIN into the public feed, believing the current contract already uses a safe display name. The runtime is correct today; the risk is stale test/comment guidance around a privacy boundary.

**Suggested fix**

Update the privacy-test comment and browser-upload comment to match the current invariant: `uploaded_by` is stored for admin attribution only, public feed rows return `author_name = NULL`, and per-entry authors are forward-looking until a non-login `display_name` exists.

### LOW / Risk / Medium Confidence - Resolved-path stream tests overstate TOCTOU protection

**Evidence**

- Backup download validates with `lstat(filePath)`, then `realpath(filePath)`, then streams by path with `createReadStream(resolvedFilePath)` (`apps/web/src/app/api/admin/db/download/route.ts:50-75`). The comment says this closes the symlink-replacement TOCTOU gap (`route.ts:72-74`).
- Upload serving has the same pattern: `lstat(absolutePath)`, `realpath(absolutePath)`, then `createReadStream(resolvedPath)` (`apps/web/src/lib/serve-upload.ts:175-265`) with the same "close the TOCTOU gap" comment (`serve-upload.ts:261-264`).
- The source-contract test only asserts the stream uses the resolved path, not an already-opened fd or `O_NOFOLLOW` open (`apps/web/src/__tests__/resolved-stream-source.test.ts:9-18`). It passed.

**Failure scenario**

If an attacker or compromised co-tenant has same-host write access to the backup or upload directory, they can replace the validated path after `realpath()` and before `createReadStream()`. Streaming the resolved pathname avoids the original pre-validation path, but it does not make the file identity immutable after validation. This is not a remote-only exploit with the current generated filenames and private backup directory posture, so severity stays low; the mismatch is the overclaimed invariant in comments/tests.

**Suggested fix**

For routes that truly need race-free local-file serving, open the file first with a no-follow flag (`fs.promises.open(path, O_RDONLY | O_NOFOLLOW)` where supported), `fstat()` the file handle, validate containment/regular-file assumptions, and stream from the file handle rather than reopening by pathname. If the project accepts the residual local-race risk, weaken the comments/tests to say "streams the resolved path" instead of "closes the TOCTOU gap."

## Confirmed Correct Invariants

- Admin API exports are wrapped by `withAdminAuth(...)`, including the LR token route with `allowTokenScope: 'lr:upload'`.
- Mutating server actions return early on `requireSameOriginAdmin()` or carry explicit public/read-only exemptions.
- Public mutating API route scanner passed; public GET routes with expensive work were manually checked for rate limits or generic/no-DB metadata behavior.
- Public image reads use `publicSelectFields`, `publicMapSelectFields` with `topics.map_visible = true`, `timelineSelectFields` with the shared sensitive-key guard, or `searchEnrichmentSelectFields` with a type-only `PrivacySensitiveKeys` guard.
- Browser and Lightroom upload paths both gate HDR ingest, strip GPS originals when configured, snapshot processing settings, validate topic existence before insert, acquire the upload-processing contract lock, and settle upload tracker claims on pre-success returns.
- Restore holds DB restore, backfill, upload-processing, maintenance, and queue lifecycle gates through the restore window; the cycle-12 `finally` concern in `plan-371-cycle12-fixes.md` is a false positive as documented.
- Migration journal/reconcile coverage supports current tables, columns, indexes, known drops, and Drizzle skipped-migration postconditions.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` -> passed; 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` -> passed; all mutating server actions enforce same-origin provenance or explicit public/read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm run lint --workspace=apps/web` -> passed.
- `npm run typecheck --workspace=apps/web` -> passed; route types generated, app/scripts typecheck clean.
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/atom-feed.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/shared-route-rate-limit-source.test.ts src/__tests__/lr-upload-hdr-gate.test.ts` -> 8 files passed, 173 tests passed.
- `npm test --workspace=apps/web -- src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/migration-journal.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/og-route-source-contracts.test.ts` -> 6 files passed, 111 tests passed.
- `npm test --workspace=apps/web -- src/__tests__/resolved-stream-source.test.ts` -> 1 file passed, 2 tests passed.

## Files And Regions Reviewed

- Auth/admin/token routes: `apps/web/src/lib/api-auth.ts:55-140`, `apps/web/src/lib/admin-tokens.ts:137-242`, `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`, `apps/web/src/app/api/admin/db/download/route.ts:22-101`.
- Public API/serving: `apps/web/src/app/api/search/semantic/route.ts:106-355`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-235`, `apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`, `apps/web/src/lib/serve-upload.ts:127-309`.
- Public pages/actions: share pages under `s/[key]` and `g/[key]`, root/topic feed routes, `apps/web/src/app/actions/public.ts:31-439`.
- Upload/mutation actions: `apps/web/src/app/actions/images.ts:114-1275`, `apps/web/src/app/actions/collections.ts:15-139`, `apps/web/src/app/[locale]/admin/db-actions.ts:36-648`.
- Data/privacy/feed: `apps/web/src/lib/data.ts:251-507`, `apps/web/src/lib/data.ts:828-947`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/lib/atom-feed.ts:21-165`.
- Schema/migrations/deploy: `apps/web/src/db/schema.ts:1-310`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/0006_admin_tokens.sql`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`, `apps/web/scripts/migrate.js:293-760`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`.

## Final Sweep

Commonly missed checks completed:

- Dynamic route paths with shell-sensitive brackets/parentheses were re-read with quoted paths.
- Source-contract tests were compared against the implementation they claim to lock, not just run for pass/fail.
- Public GET surfaces were reviewed despite the public-route scanner only blocking mutating handlers.
- Stale privacy wording around `uploaded_by` was cross-checked against docs, data helper, feed routes, and tests.
- Filesystem path validation was checked for both backup downloads and upload serving, including what the tests actually assert.

No critical, high, or medium correctness findings were identified in this pass.
