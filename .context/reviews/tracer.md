# Tracer Review — Cycle 1 Deep Review Lane (2026-04-24)

## Scope

Causal-flow review for `/Users/hletrd/flash-shared/gallery`. I traced the requested flows end-to-end instead of reviewing isolated functions:

- upload -> DB -> queue -> public serving
- auth -> session -> middleware/proxy -> server actions/API routes
- backup/restore -> maintenance window -> queue/action quiescence
- sitemap/metadata -> DB/config -> public URLs
- sharing -> DB keys/groups -> public pages
- rate limits -> in-memory + DB buckets -> rollback behavior
- CI/build/deploy config -> fresh checkout/container/reverse proxy behavior

Changes are limited to this review file.

## Inventory first: files and causal edges inspected

| Flow | Primary edges inspected |
| --- | --- |
| Upload -> DB -> queue -> serving | `apps/web/src/app/actions/images.ts:83-348` validates/admin-gates uploads, saves originals, inserts `processed=false`, enqueues jobs; `apps/web/src/lib/process-image.ts:224-460` writes private originals and public derivatives; `apps/web/src/lib/image-queue.ts:171-320,330-407` claims jobs, converts files, verifies outputs, flips `processed=true`, bootstraps pending rows; `apps/web/src/lib/upload-paths.ts:11-46` splits private originals from public derivatives; `apps/web/src/lib/serve-upload.ts:32-115` hardens app-level `/uploads` serving; `apps/web/src/db/schema.ts:16-66` stores filenames/processed state; `apps/web/src/lib/data.ts:295-459,834-845` only exposes processed public rows; docs at `CLAUDE.md:109-115,167-177,207-213`. |
| Auth -> session -> middleware -> actions/API | `apps/web/src/app/actions/auth.ts:80-155,300-345`; `apps/web/src/lib/session.ts:16-145`; `apps/web/src/proxy.ts:12-64`; `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17`; `apps/web/src/lib/action-guards.ts:37-44`; `apps/web/src/lib/request-origin.ts:32-90`; `apps/web/src/lib/api-auth.ts:9-19`; lint gates `apps/web/scripts/check-action-origin.ts:1-126` and `apps/web/scripts/check-api-auth.ts:1-130`; docs at `CLAUDE.md:117-131,238-243`. |
| Backup/restore | `apps/web/src/app/[locale]/admin/db-actions.ts:101-235,245-315,345-415`; `apps/web/src/app/api/admin/db/download/route.ts:13-108`; `apps/web/src/lib/backup-filename.ts:3-12`; `apps/web/src/lib/db-restore.ts` (restore stdin error contract); `apps/web/src/lib/sql-restore-scan.ts:1-84`; `apps/web/src/lib/restore-maintenance.ts:1-56`; queue quiescence at `apps/web/src/lib/image-queue.ts:385-407`; docs at `CLAUDE.md:141-147,189-191,212`. |
| Sitemap/metadata | `apps/web/src/app/sitemap.ts:1-56`; root metadata `apps/web/src/app/[locale]/layout.tsx:15-48`; photo metadata `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:24-104,139-160`; share metadata `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:32-84` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-83`; URL/config sources `apps/web/src/lib/constants.ts:1-14`, `apps/web/src/lib/seo-og-url.ts:1-30`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`; `apps/web/src/site-config.example.json`. |
| Sharing | `apps/web/src/app/actions/sharing.ts:92-185,188-305,307-370`; `apps/web/src/lib/data.ts:548-665`; public share pages above; DB schema `apps/web/src/db/schema.ts:87-104`; key generation/validation via `apps/web/src/lib/base56.ts`. |
| Rate limits | Core helper `apps/web/src/lib/rate-limit.ts:51-215`; auth callers `apps/web/src/app/actions/auth.ts:91-142,313-337`; public search `apps/web/src/app/actions/public.ts:65-97`; sharing `apps/web/src/app/actions/sharing.ts:52-90,117-130,228-243`; upload tracker `apps/web/src/app/actions/images.ts:122-186`; tests under `apps/web/src/__tests__/*rate-limit*`. |
| CI/build/deploy config | Root `package.json:10-20`; app `apps/web/package.json:8-22`; `apps/web/scripts/ensure-site-config.mjs:1-9`; `.github/workflows/quality.yml:38-76`; `apps/web/playwright.config.ts:54-57`; `apps/web/Dockerfile:34-45,56-69`; `apps/web/docker-compose.yml:3-22`; `apps/web/nginx/default.conf:1-123`; `apps/web/deploy.sh:1-34`; `.dockerignore:1-16`; `apps/web/.gitignore:40-49`; docs `README.md:149-168`, `apps/web/README.md:25-34`, `CLAUDE.md:245-253`. |

## Findings summary

| ID | Severity | Confidence | Flow | Title |
| --- | --- | --- | --- | --- |
| TRACE-C1-01 | HIGH | HIGH | CI/build config | Fresh-checkout CI build/E2E lacks the required ignored `site-config.json`. |
| TRACE-C1-02 | HIGH | MEDIUM-HIGH | Upload -> public serving / deploy config | Shipped nginx upload `root` does not match the documented host-network deployment path. |
| TRACE-C1-03 | MEDIUM | HIGH | Auth/rate limits | Login/password DB buckets still check before DB increment, so distributed bursts can overrun the documented source-of-truth limit. |
| TRACE-C1-04 | LOW | HIGH | Topics/uploaded resources | `createTopic` writes a topic image before the route-conflict check, then returns without cleanup. |
| TRACE-C1-05 | MEDIUM | MEDIUM | Backup/restore | Restore maintenance is process-local while several guarded writes are DB/global side effects. |

---

## TRACE-C1-01 — Fresh-checkout CI build/E2E lacks the required ignored `site-config.json`

- **Severity:** HIGH
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/package.json:8-12` — `prebuild` runs `node scripts/ensure-site-config.mjs` before `next build`.
  - `apps/web/scripts/ensure-site-config.mjs:4-8` — exits non-zero when `src/site-config.json` is missing.
  - `apps/web/.gitignore:48-49` — `/src/site-config.json` is intentionally ignored.
  - `git ls-files apps/web/src/site-config*` only includes `apps/web/src/site-config.example.json`.
  - `.github/workflows/quality.yml:48-76` — checkout/install/lint/typecheck/tests/init/e2e/build, but no step creates `apps/web/src/site-config.json`.
  - `apps/web/playwright.config.ts:54-57` — local Playwright webServer runs `npm run build`, so E2E also hits `prebuild` before the explicit workflow build step.

### Causal trace

`GitHub Actions checkout` -> ignored `apps/web/src/site-config.json` absent -> `npm run test:e2e` starts Playwright webServer -> `npm run build` -> app `prebuild` -> `ensure-site-config.mjs` exits with “Missing required src/site-config.json” -> E2E/build gate fails before runtime tests can exercise the app.

### Concrete failure scenario

A contributor pushes a branch from a machine where the ignored local `src/site-config.json` exists. CI receives a clean checkout containing only `src/site-config.example.json`. The workflow reaches “End-to-end tests”; Playwright invokes `npm run build` and fails immediately. The later “Build” step would fail the same way. The code can be locally correct while CI is structurally red on every fresh runner.

### Competing hypotheses considered

- **CI injects the config through secrets/artifacts.** Not supported by `.github/workflows/quality.yml:38-76`; no copy, heredoc, checkout artifact, or secret materialization step exists.
- **The example config is tracked and auto-used.** Contradicted by `apps/web/scripts/ensure-site-config.mjs:4-8`, which requires the real file and does not fall back.
- **Only production builds require the real file.** The current `prebuild` is unconditional for all `npm run build` invocations, including Playwright.

### Fix

Add an explicit CI setup step before any command that can build:

```yaml
- name: Prepare test site config
  run: cp apps/web/src/site-config.example.json apps/web/src/site-config.json
```

Alternatively, make `ensure-site-config.mjs` accept a deliberate `CI=true` test fallback while keeping production/deploy fail-fast. Whichever path is chosen, ensure it runs before Playwright’s webServer build, not only before the final Build step.

---

## TRACE-C1-02 — Shipped nginx upload `root` does not match the documented host-network deployment path

- **Severity:** HIGH
- **Confidence:** MEDIUM-HIGH
- **Files/regions:**
  - `apps/web/nginx/default.conf:89-95` — nginx intercepts `/uploads/(jpeg|webp|avif)/...` and serves from fixed `root /app/apps/web/public`.
  - `apps/web/docker-compose.yml:10-22` — the app container uses `network_mode: host`; nginx is host-managed, not a service in the compose file, and host `./public` is bind-mounted only into the app container at `/app/apps/web/public`.
  - `README.md:155-168` — deployment says host-network app listens on localhost and should be published through a reverse proxy; processed derivatives remain under `public/uploads/`.
  - `apps/web/deploy.sh:3-34` — script can run from arbitrary repo root and states data is persisted under `apps/web/public`.
  - App fallback serving is hardened at `apps/web/src/app/uploads/[...path]/route.ts:4-10` and `apps/web/src/lib/serve-upload.ts:32-115`, but nginx handles matching upload URLs before they reach Next.

### Causal trace

`uploadImages()` -> DB row inserted with public derivative filenames -> queue creates `apps/web/public/uploads/{jpeg,webp,avif}/...` -> public page emits `/uploads/jpeg/...` -> host nginx matches `apps/web/nginx/default.conf:92` -> nginx looks under host path `/app/apps/web/public/uploads/...` -> if the repo is deployed anywhere other than host `/app`, nginx returns 404 and never proxies to Next’s `serveUploadFile` route.

### Concrete failure scenario

An operator follows `README.md:155-168` on `/home/ubuntu/gallery`, runs `docker compose -f apps/web/docker-compose.yml up -d --build`, and copies the provided nginx config to host nginx. The app successfully uploads and processes images into `/home/ubuntu/gallery/apps/web/public/uploads/...`, but browser requests for `/uploads/jpeg/<id>.jpg` are served by nginx from `/app/apps/web/public/uploads/...` and 404. The gallery pages render metadata and image tags from DB but all public image assets are broken.

### Competing hypotheses considered

- **nginx is intended to run in a container where `/app/apps/web/public` is mounted.** The checked-in compose file has no nginx service and explicitly says the host reverse proxy handles traffic (`apps/web/docker-compose.yml:10-12`).
- **Operators may deploy the repo at `/app`.** Possible, which is why confidence is medium-high rather than absolute; however `deploy.sh:3-7` documents an arbitrary repo root and `README.md` does not tell users to deploy at `/app` or rewrite the nginx root.
- **Next can serve `/uploads` if nginx misses.** The regex location catches valid public derivative URLs first (`apps/web/nginx/default.conf:92`), so a wrong nginx root prevents fallback to `serveUploadFile`.

### Fix

Choose one deployment contract and encode it:

1. Template the nginx static root to the real host path, e.g. `/home/ubuntu/gallery/apps/web/public`, and document the substitution; or
2. Add an nginx service to `apps/web/docker-compose.yml` with a bind mount that makes `/app/apps/web/public` real inside that nginx container; or
3. Remove/directly disable the static `/uploads` nginx location and proxy `/uploads` to Next, relying on `serveUploadFile` until a correct static mount is configured.

Also add a deployment smoke test that requests an actual processed file through the reverse proxy, not only through the Node app.

---

## TRACE-C1-03 — Login/password DB buckets still check before DB increment, so distributed bursts can overrun the documented source-of-truth limit

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/auth.ts:91-142` — login checks the DB buckets at `110-127`, then increments them at `139-141`.
  - `apps/web/src/app/actions/auth.ts:313-337` — password-change checks the DB bucket at `320-324`, then increments at `337`.
  - `apps/web/src/lib/rate-limit.ts:51-53,172-215` — `checkRateLimit()` treats `count >= max` as limited before increment; `incrementRateLimit()` is an atomic upsert but is called later.
  - Contrasting fixed pattern: `apps/web/src/app/actions/sharing.ts:121-130,232-240` and `apps/web/src/app/actions/public.ts:72-94` increment first, check with “includes current request” semantics, and roll back on over-limit.
  - Documentation claims DB source-of-truth and account buckets at `apps/web/src/lib/rate-limit.ts:22-23` and `CLAUDE.md:123-125`.

### Causal trace

`login()` / `updatePassword()` -> in-process Map fast path -> `checkRateLimit()` reads current DB count -> request is allowed while count is still below max -> request increments DB bucket -> expensive Argon2 verify / password update path runs. Across multiple Node processes, the per-process Map is not shared, so the DB ordering is the only cross-process guard and still has a check-then-increment window.

### Concrete failure scenario

Two app processes handle simultaneous bad login attempts for the same account bucket when the DB row count is `4` and max is `5`. Both processes call `checkRateLimit()` before either increments. Both see `count=4`, both pass, both increment, and both run Argon2 verification. The resulting DB count is `6`, meaning one extra expensive guess was admitted. A wider burst across rolling deployments, PM2/cluster mode, or multiple containers can admit several extra attempts in the same window.

### Competing hypotheses considered

- **The in-memory Map closes this race.** It does within a single Node process, but not across multiple processes; the code and docs explicitly call the DB the accuracy/source-of-truth layer across restarts.
- **Default Docker runs one Node process.** True for the checked-in compose, reducing likelihood for the default install, but the queue and restore code already contain MySQL advisory locks for multi-process safety, so this repo does consider multi-process/restart-boundary races.
- **The comments say this is already fixed.** The comments at `auth.ts:132-134` and `auth.ts:329-332` refer to pre-increment before Argon2, but the DB check still precedes the DB increment at `auth.ts:108-141` and `auth.ts:320-337`.

### Fix

Make auth match the safer sharing/search pattern:

- Increment the DB bucket first for both IP and account scopes.
- Check with `isRateLimitExceeded(dbLimit.count, max, true)` / `count > max` semantics.
- If over limit, roll back both the in-memory and DB counters before returning.
- For login, treat the IP and account buckets as one unit: if the second bucket rejects, roll back the first bucket too.

For strongest correctness, replace read-after-increment with one atomic conditional upsert/update that refuses to increment past the limit, but ordering parity with sharing/search would already close the largest causal gap.

---

## TRACE-C1-04 — `createTopic` writes a topic image before the route-conflict check, then returns without cleanup

- **Severity:** LOW
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/topics.ts:96-105` — optional topic image is processed and written before route-conflict checks.
  - `apps/web/src/app/actions/topics.ts:107-127` — `withTopicRouteMutationLock()` checks `topicRouteSegmentExists(slug)` and returns `{ error: t('slugConflictsWithRoute') }` on conflict.
  - `apps/web/src/app/actions/topics.ts:128-131` — image cleanup only runs in `catch`; a returned error from the lock callback skips this cleanup.
  - `apps/web/src/lib/process-topic-image.ts:55-80` — processing writes `public/resources/<uuid>.webp` and returns the filename.

### Causal trace

`createTopic(formData with image)` -> `processTopicImage()` writes a UUID WebP into `public/resources` -> route-segment lock acquired -> `topicRouteSegmentExists(slug)` detects a conflict -> callback returns an error object -> outer `try` completes normally -> `catch` cleanup never runs -> file remains public but unreferenced by any topic row.

### Concrete failure scenario

An admin tries to create a topic with slug `admin` or another slug/alias that already exists and uploads a topic cover image. The action rejects the topic because the slug conflicts, but the processed cover file remains under `apps/web/public/resources/`. Repeated conflict attempts accumulate orphaned files. The filenames are UUID-based, so direct discovery is unlikely, but storage grows and backup/deploy artifacts can contain unreferenced public media.

### Competing hypotheses considered

- **The UI may prevent duplicate/reserved slugs.** Server-side checks exist because the action is the authority; the leak happens exactly on the server-side conflict path.
- **The catch cleanup handles DB duplicate failures.** It handles thrown exceptions such as `ER_DUP_ENTRY`, but not the explicit returned conflict object at `topics.ts:109-110`.
- **Topic image temp cleanup at queue bootstrap covers it.** `cleanOrphanedTopicTempFiles()` removes `tmp-*` files only (`process-topic-image.ts:95-105`), not completed UUID `.webp` resources.

### Fix

Move all cheap slug/route availability checks before `processTopicImage()` where possible. If the lock must wrap the check for race reasons, then on every non-success return after `imageFilename` is set, call `deleteTopicImage(imageFilename)` before returning. A small helper such as `return cleanupTopicImageAndError(...)` would avoid missing future returned-error branches.

---

## TRACE-C1-05 — Restore maintenance is process-local while guarded writes are DB/global side effects

- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Files/regions:**
  - `apps/web/src/lib/restore-maintenance.ts:1-56` — maintenance state is stored on `globalThis`, therefore scoped to one Node process.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:254-315` — restore holds a MySQL advisory lock for restore concurrency, sets local maintenance, flushes shared-group counters, quiesces the local queue, runs restore, then clears local maintenance.
  - Mutating actions check only the local flag, e.g. `apps/web/src/app/actions/images.ts:83-94`, `apps/web/src/app/actions/sharing.ts:92-99,188-195,307-314`, and `apps/web/src/app/actions/topics.ts:59-66`.
  - Queue bootstrap/enqueue checks the same local flag at `apps/web/src/lib/image-queue.ts:171-175,330-333`; queue quiescence is local at `apps/web/src/lib/image-queue.ts:385-407`.
  - Docs explicitly reason about advisory locks across workers at `CLAUDE.md:189-191`.

### Causal trace

`process A restoreDatabase()` -> MySQL advisory lock prevents only another restore -> `beginRestoreMaintenance()` flips `globalThis` in process A -> process A actions/queue stop -> process B in the same deployment has `globalThis.restoreMaintenance.active=false` -> process B can accept uploads/share/topic/settings mutations against the same DB and filesystem while process A is restoring DB state.

### Concrete failure scenario

A deployment scales the Next standalone server to two Node processes or two host-network containers behind the same reverse proxy. An admin starts DB restore on process A. During the restore window, a second admin request lands on process B and uploads images. Process B writes private originals/public derivatives and inserts DB rows while process A is piping the SQL dump. Depending on timing, the restored DB can discard the newly inserted rows while the files remain, or later restore statements can overwrite metadata while process B's queue continues processing filenames from a transient row set.

### Competing hypotheses considered

- **The documented compose file starts one Node process.** Correct; this lowers likelihood for the default install and is why confidence is medium. The codebase nevertheless contains cross-process advisory locks for queue claims and restore serialization, so process-level assumptions are already not universal.
- **The restore advisory lock prevents this.** It only serializes calls to `restoreDatabase()` (`db-actions.ts:263-268`); other mutating actions do not attempt to acquire/read that lock.
- **Queue quiescence protects uploads.** It quiesces the local PQueue only; another process has a separate `globalThis` queue and separate in-memory enqueued set.

### Fix

Persist restore maintenance state in a DB-backed or advisory-lock-backed mechanism visible to every process. Options:

1. Add an `admin_settings`/dedicated table maintenance row with `active`, `started_at`, and owner token; every mutating action reads it before proceeding.
2. Have mutating actions attempt a non-blocking read/claim of a shared MySQL advisory lock that indicates restore maintenance, not just restore concurrency.
3. If multi-process deployments are unsupported, enforce that explicitly: document one process only during restore and add a startup/deploy guard so operators do not scale web workers without changing the restore gate.

The same cross-process signal should pause enqueue/bootstrap and should be checked after long upload file writes before DB insert, mirroring the current local `cleanupOriginalIfRestoreMaintenanceBegan()` behavior.

---

## Checked non-findings / causal notes

- **Public image privacy:** Public listing/detail/share queries intentionally use `publicSelectFields`; `getImageByShareKey()` and `getSharedGroup()` omit `filename_original`, `user_filename`, latitude, and longitude (`apps/web/src/lib/data.ts:548-665`). The schema still stores those fields (`apps/web/src/db/schema.ts:18,28,40-41`), but the public data edge does not expose them in the inspected paths.
- **Serving path traversal:** App-level upload serving validates top-level dirs, safe path segments, extension/dir match, symlink status, and realpath containment (`apps/web/src/lib/serve-upload.ts:32-115`). The nginx-root mismatch above is a deployment path issue, not an app route traversal issue.
- **Queue duplicate processing:** Queue jobs validate filenames (`apps/web/src/lib/image-queue.ts:128-133`), use MySQL `GET_LOCK` per image (`image-queue.ts:135-162`), recheck `processed=false` (`image-queue.ts:216-222`), and conditionally mark processed (`image-queue.ts:272-286`). I did not confirm a current duplicate-conversion data corruption path.
- **Backup download path:** The download API is wrapped with `withAdminAuth` (`apps/web/src/app/api/admin/db/download/route.ts:13`), requires same-origin provenance (`download/route.ts:27-32`), validates backup filename (`download/route.ts:34-40`), rejects symlinks/non-files and realpath escapes (`download/route.ts:53-74`), and emits no-store headers (`download/route.ts:85-93`).
- **Share keys:** Photo and group creation use Base56 keys with DB uniqueness and retry loops (`apps/web/src/app/actions/sharing.ts:135-185,245-305`), public readers validate key shape before querying (`apps/web/src/lib/data.ts:552-568,594-615`), and share pages set noindex/nocache robots metadata (`s/[key]/page.tsx:14-24`, `g/[key]/page.tsx:15-25`).
- **Sitemap:** Sitemap pulls only processed image IDs (`apps/web/src/lib/data.ts:834-845`) and caps at 24,000 images for two locales (`apps/web/src/app/sitemap.ts:14-23,41-55`). I did not confirm a stale/unprocessed image leak in sitemap generation.
- **Action/API guard coverage:** The repo has static guard scripts for mutating server actions and admin API route auth (`apps/web/scripts/check-action-origin.ts:1-126`, `apps/web/scripts/check-api-auth.ts:1-130`) and the workflow invokes both (`.github/workflows/quality.yml:57-60`). The CI config bug above can prevent the workflow from completing, but the guard scripts themselves cover the scanned shapes.

## Final missed-issues sweep

After the inventory pass, I re-swept the causal seams rather than only the files with findings:

- Searched upload path constants, all `/uploads` routes, nginx/static serving, and docs to distinguish app serving hardening from deploy-root mismatch.
- Compared auth DB rate-limit ordering against sharing/search patterns to avoid reporting all pre-increment code as equivalent.
- Followed restore from request validation through maintenance, queue quiescence, SQL scan, child-process mysql execution, and finally back to action/queue guards.
- Checked sitemap/metadata/share pages for use of processed-only data and noindex share robots.
- Checked CI from root scripts through workspace scripts, Playwright webServer, workflow steps, Dockerfile, gitignore/dockerignore, and deploy docs.

No additional stronger causal-flow issue was confirmed in this pass beyond the five findings above.
