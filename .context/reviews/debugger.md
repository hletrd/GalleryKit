# Debugger — Cycle 1 Deep Review Fan-out Continuation

**Repo:** `/Users/hletrd/flash-shared/gallery`
**Role/scope:** debugger pass for latent bugs/failure modes/regressions.
**Write scope honored:** only `.context/reviews/debugger.md` was edited; no source files were changed.

## Inventory first

Reviewed current runtime surfaces and failure-prone flows:

- **Upload / processing / delete flow:** `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`.
- **Restore / backup / shell commands:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`, Docker entrypoint/deploy files.
- **Route edge cases:** public photo/topic/share routes, upload routes, `proxy.ts`, `sitemap.ts`, `robots.ts`, API health/live/OG/download routes.
- **Auth/rate-limit/session/env absence:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`, env examples.
- **Existing concurrent review state:** other review files are modified by sibling agents; I did not touch them.

## Findings

### DBG-01 — Concurrent share-link losers consume the create-share rate limit even when they only return the winner's key

- **Severity:** Medium
- **Confidence:** High
- **File/lines:** `apps/web/src/app/actions/sharing.ts:118-131`, `apps/web/src/app/actions/sharing.ts:141-168`
- **Failure scenario:** two admin requests create a photo share link for the same image concurrently. Both pass the initial `share_key` check. One request writes the new key at lines 141-153. The losing request then re-fetches and returns the winner's key at lines 156-168, but it already incremented both in-memory and DB-backed `share_photo` rate-limit buckets at lines 118-131 and never rolls them back on this no-op success path.
- **Impact:** repeated double-clicks, retrying UI calls, or two admin tabs can burn the 20/minute share budget despite only one share link being created. The non-racy existing-key fast path at lines 114-116 avoids the limit, so this is a race-only behavior mismatch.
- **Suggested fix:** when `refreshedImage.share_key` is returned at lines 167-168, call `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)` first, or defer rate-limit charging until the conditional update actually affects a row.

### DBG-02 — Permanently bad image-processing jobs retry forever with no terminal failed state

- **Severity:** Medium
- **Confidence:** High
- **File/lines:** `apps/web/src/lib/image-queue.ts:248-255`, `apps/web/src/lib/image-queue.ts:317-331`, `apps/web/src/lib/image-queue.ts:395-443`
- **Failure scenario:** an original file is missing after restore/manual cleanup, or Sharp consistently fails on a corrupt-but-inserted file. The job throws at lines 248-255 or during `processImageFormats`, exhausts the in-memory retry count at lines 317-331, then sets `bootstrapped=false` and schedules another bootstrap. The bootstrap query at lines 395-443 selects the same `processed=false` row again, resetting the retry map cycle in a new pass.
- **Impact:** one unrecoverable row can cause an unbounded 30-second retry/log loop and repeated filesystem/Sharp work. There is no DB-visible terminal state for admins to distinguish “still processing” from “cannot ever process.”
- **Suggested fix:** add a persisted failure marker/counter (`processing_failed_at`, `processing_error`, or similar), or move exhausted jobs out of the bootstrap predicate after bounded retries. Surface the state in admin UI with an explicit retry action.

### DBG-03 — Restore temp files can leak and restore can surface a raw 500 on unexpected post-upload filesystem errors

- **Severity:** Medium
- **Confidence:** Medium
- **File/lines:** `apps/web/src/app/[locale]/admin/db-actions.ts:380-389`, `apps/web/src/app/[locale]/admin/db-actions.ts:391-439`, `apps/web/src/app/[locale]/admin/db-actions.ts:441-521`
- **Failure scenario:** after the uploaded SQL is successfully streamed to `tempPath` at lines 380-389, subsequent operations (`fs.open`, `fd.read`, `fs.stat`, scan reads, or stream setup) are not covered by an outer `try/finally` that always unlinks `tempPath`. Some explicit validation failures do unlink, and the mysql close path unlinks, but unexpected exceptions between lines 391-439 skip cleanup and bubble out of `runRestore`.
- **Impact:** transient filesystem errors or descriptor/read failures can leave `/tmp/restore-*.sql` behind and return an unlocalized 500 from the server action. The outer restore `finally` ends maintenance, but it does not know the temp path.
- **Suggested fix:** wrap the whole post-creation restore path in a `try/catch/finally` with a `tempCreated` flag; unlink `tempPath` in `finally` unless ownership has moved to the mysql close handler, and convert unexpected errors into `{ success:false, error:t('restoreFailed') }`.

### DBG-04 — Drizzle CLI config builds a malformed DB URL when required env vars are absent

- **Severity:** Low
- **Confidence:** High
- **File/lines:** `apps/web/drizzle.config.ts:2-11`, compared with `apps/web/scripts/mysql-connection-options.js:3-23`
- **Failure scenario:** running `npm run db:push --workspace=apps/web` without a complete `.env.local` produces a URL like `mysql://:@undefined:undefined/undefined` instead of failing with a precise missing-variable message. Runtime migration helpers use `getRequiredEnv()` and fail explicitly, but the Drizzle CLI path does not.
- **Impact:** operator/debugger time sink; can mask whether the problem is env loading, hostname, auth, or database name.
- **Suggested fix:** reuse a required-env helper in `drizzle.config.ts` and default only `DB_PORT` to `3306`; throw clear errors for missing `DB_HOST`, `DB_USER`, `DB_PASSWORD`, or `DB_NAME` before constructing `dbCredentials.url`.

## Final sweep

- Upload self-contention from the previous debugger note appears addressed now: `upload-dropzone.tsx:239-246` uploads sequentially while the server lock remains exclusive.
- Missing original files no longer silently return early; they throw into retry handling. The remaining issue is lack of a terminal failed state after retries are exhausted.
- Backup dump/restore child process paths have handlers for spawn errors, stderr redaction, stream write/read errors, and non-zero exits. The main remaining restore gap is cleanup/localized failure for unexpected filesystem exceptions after the temp file exists.
- Restore maintenance, upload quotas, and queue state are process-local by design and documented in `README.md:146`; I did not count that as a bug as long as the documented single-instance topology is enforced.
- No tests or destructive commands were run for this review-only pass.
