# Cycle 5 deep repository review

## Verification
- `npm run lint --workspace=apps/web` ✅
- `npm run typecheck --workspace=apps/web` ✅
- `npm run test --workspace=apps/web` ✅
- `npm run test:e2e --workspace=apps/web` ⛔ the local web server bootstrap stopped on missing DB env (`DB_NAME`) in this shell, so I treated that as an environment prerequisite rather than a code defect.

## Findings

### 1) Image-processing retries can deadlock after a temporary claim miss
- **Severity:** HIGH
- **Confidence:** High
- **Status:** confirmed
- **File:** `apps/web/src/lib/image-queue.ts:191-223, 315-324`
- **What happens:** if `acquireImageProcessingClaim(job.id)` returns `null`, the code schedules `setTimeout(() => enqueueImageProcessing(job), delay)` but leaves `state.enqueued` set. When the timer fires, `enqueueImageProcessing()` immediately returns at line 191 because the job is still marked as enqueued, so the retry never actually happens.
- **Failure scenario:** a job that briefly loses the MySQL claim to another worker, or to a stale lock during failover, can remain stuck forever in the pending state instead of being retried.
- **Suggested fix:** clear `state.enqueued.delete(job.id)` before scheduling the delayed retry, or add a retry-only path that bypasses the `enqueued` guard. Add a regression test that simulates one claim miss and verifies the retry actually requeues.

### 2) Restore-file header validation accepts malformed dumps because the regex is grouped incorrectly
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:355-359`
- **What happens:** `validHeader` is built with `/^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/`. The `^` anchor only applies to the first alternative, so any header text that contains `CREATE`, `INSERT`, `DROP`, `SET`, or `/*!` anywhere in the first 256 bytes passes the check.
- **Failure scenario:** a non-dump file or a crafted blob with one of those tokens buried in a header comment/metadata can slip past the front-door validation and reach the MySQL restore step, which defeats the purpose of the preflight guard.
- **Suggested fix:** group the alternation, e.g. `^(?:--|CREATE\s|INSERT\s|DROP\s|SET\s|/\*!)`, and add a test for both a valid dump header and a misleading header that only contains the keyword later in the string.

### 3) Auth rate-limit cleanup mutates in-memory state before the DB reset succeeds, so auth success/failure paths can drift
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** likely
- **Files:** `apps/web/src/app/actions/auth.ts:168-179, 385-395` and `apps/web/src/lib/auth-rate-limit.ts:29-31, 65-67`
- **What happens:** `clearSuccessfulLoginAttempts()` and `clearSuccessfulPasswordAttempts()` delete the in-memory entry first and then attempt the DB reset. If the DB cleanup fails, the in-memory bucket is already gone but the DB bucket remains, so later attempts can be throttled by stale DB state even after a successful auth event.
- **Extra login-path issue:** `login()` clears the rate-limit buckets *before* the session row/cookie are created. If the session transaction fails after that point, the catch block only rolls back one counter from an already-cleared bucket, which erases prior failed-attempt pressure.
- **Failure scenario:** a transient DB error during the cleanup step can leave a user apparently authenticated but still rate-limited on the next attempt, or a failed session-creation attempt can reset the login budget too early.
- **Suggested fix:** make the cleanup order transactional: do the irreversible auth step first, then clear the buckets; and in the helper functions, only delete the in-memory entry after the DB reset succeeds (or restore the previous state if the DB write fails). That keeps the two counters in sync.

### 4) Tag slug normalization depends on the host/browser locale, so tag identity can drift across environments
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** likely
- **Files:** `apps/web/src/components/tag-input.tsx:24-35` and `apps/web/src/lib/tag-records.ts:5-12`
- **What happens:** both the client-side tag matcher and the server-side slug generator use `toLocaleLowerCase()` with no explicit locale. That makes normalization depend on the browser/Node default locale instead of a stable language-agnostic rule.
- **Failure scenario:** on a Turkish or otherwise non-English locale, casing for letters like `I/i` can normalize differently on the client and server. That can produce duplicate suggestions, failed exact-match detection, or inconsistent slugs across deployments.
- **Suggested fix:** switch both call sites to locale-stable normalization (`toLowerCase()` or `toLocaleLowerCase('en-US')`) and add a regression test for a locale-sensitive input.

### 5) The upload-dropzone limit warning is emitted from a functional state updater, which is a side-effectful pattern
- **Severity:** LOW
- **Confidence:** Medium
- **Status:** confirmed
- **File:** `apps/web/src/components/upload-dropzone.tsx:119-145`
- **What happens:** the `toast.error(...)` call lives inside the `setFiles(prev => { ... })` updater. Functional updaters are supposed to be pure; React can replay them under concurrent rendering / Strict Mode, which can duplicate side effects.
- **Failure scenario:** a single over-limit drop can show the limit toast more than once in development or under render replays.
- **Suggested fix:** move the toast emission out of the updater. Compute the rejected count first, call `toast.error(...)` once, and then update state with a pure `setFiles` callback.

## Final missed-issues sweep
I rechecked the rest of the high-risk surfaces after the findings above: auth, rate limiting, upload/restore, image queueing, tag/topic mutation, SEO/public data loaders, and the app/api routes. I did not find another issue with comparable confidence beyond the five listed above.

## Files reviewed
Representative files and surfaces inspected in this pass:
- Root/app config: `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `README.md`, `apps/web/README.md`
- Core auth/rate-limit/restore/data logic: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/{rate-limit.ts,auth-rate-limit.ts,request-origin.ts,restore-maintenance.ts,db-restore.ts,image-queue.ts,process-image.ts,process-topic-image.ts,serve-upload.ts,tag-records.ts,tag-slugs.ts,gallery-config.ts,gallery-config-shared.ts,content-security-policy.ts,image-url.ts,revalidation.ts,validation.ts,upload-paths.ts,upload-tracker.ts,upload-tracker-state.ts,storage/local.ts}`
- Routes/layouts/public pages: `apps/web/src/app/[locale]/**/*`, `apps/web/src/app/api/**/*`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- Components reviewed for runtime/UI edge cases: `apps/web/src/components/{photo-viewer.tsx,lightbox.tsx,search.tsx,upload-dropzone.tsx,image-manager.tsx,tag-input.tsx,admin-user-manager.tsx,info-bottom-sheet.tsx,nav.tsx,footer.tsx}` and the shared UI primitives under `apps/web/src/components/ui/`
- Tests and scripts used as coverage signals: `apps/web/src/__tests__/*`, `apps/web/e2e/*`, `apps/web/scripts/*`, `apps/web/drizzle/*`, `apps/web/messages/*`, `apps/web/src/site-config.example.json`
