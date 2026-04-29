# Document Specialist Review — GalleryKit

Scope: repository-wide documentation review focused on README, CLAUDE, examples, env files, scripts, Docker/deploy behavior, package commands, and supported-feature claims. Source/runtime behavior was inspected only to validate documentation accuracy. Write scope for this continuation is limited to this file.

## Inventory reviewed first

- Primary docs: `README.md:29-181`, `apps/web/README.md:7-46`, `CLAUDE.md:3-239`, `AGENTS.md:1-4`.
- Environment/config examples: `.env.deploy.example:1-14`, `apps/web/.env.local.example:1-63`, `apps/web/src/site-config.example.json:1-11`, `.gitignore:1-22`, `.dockerignore:1-22`.
- Package commands: `package.json:11-21`, `apps/web/package.json:8-25`.
- Deploy/Docker scripts: `scripts/deploy-remote.sh:1-64`, `apps/web/deploy.sh:1-34`, `apps/web/Dockerfile:1-90`, `apps/web/docker-compose.yml:1-25`, `apps/web/nginx/default.conf:1-129`.
- Config/build behavior checked against docs: `apps/web/scripts/ensure-site-config.mjs:4-42`, `apps/web/next.config.ts:36-84`, `apps/web/src/lib/upload-limits.ts:1-31`, `apps/web/src/lib/gallery-config-shared.ts:10-57`, `apps/web/src/lib/seo-og-url.ts:3-30`, `apps/web/src/proxy.ts:37-50`.
- Feature/runtime behavior checked against docs: `apps/web/src/app/actions/images.ts:159-227,373-388`, `apps/web/src/app/actions/settings.ts:75-139`, `apps/web/src/app/actions/seo.ts:137-143`, `apps/web/src/lib/data.ts:338-345,483-510`, `apps/web/src/lib/session.ts:30-45`, `apps/web/src/lib/storage/index.ts:1-17`.

## Findings

### 1) Docker docs imply `BASE_URL` in env can satisfy production build, but Compose does not pass it at build time

- **Files / regions**
  - Docs: `README.md:117-143`, `apps/web/README.md:36-38`, `apps/web/.env.local.example:9-16`.
  - Implementation: `apps/web/package.json:10-11`, `apps/web/scripts/ensure-site-config.mjs:12-37`, `apps/web/docker-compose.yml:4-9`, `apps/web/Dockerfile:35-48`.
- **Mismatch**
  - The docs say a production build can use `BASE_URL` or `site-config.json.url`, and the env example puts `BASE_URL` in `apps/web/.env.local`. But `docker-compose.yml` forwards only `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES` as build args; `.env.local` is runtime-only via `env_file` and is excluded from the Docker build context by `.dockerignore:12`. Therefore a Docker build with placeholder `site-config.json.url` still fails even if `BASE_URL` is correctly set in `apps/web/.env.local`.
- **Failure scenario**
  - An operator follows the environment setup, sets `BASE_URL=https://gallery.example.com` in `apps/web/.env.local`, leaves `src/site-config.json.url` at `https://example.com`, then runs `docker compose -f apps/web/docker-compose.yml up -d --build`. The `prebuild` guard runs with `NODE_ENV=production`, cannot see `.env.local`'s `BASE_URL`, sees the placeholder site-config URL, and aborts the image build.
- **Suggested fix**
  - Either document that Docker users must put the real public origin in `apps/web/src/site-config.json` or export `BASE_URL` in the shell/Compose interpolation environment before building; better, add `BASE_URL` as a Compose build arg and Dockerfile `ARG/ENV` alongside `IMAGE_BASE_URL`.
- **Severity**: High
- **Confidence**: High

### 2) Remote deploy helper instructions point users at `.env.deploy`, but the script ignores it by default

- **Files / regions**
  - Docs: `README.md:103-113`, `.env.deploy.example:1-14`, `.gitignore:18`.
  - Implementation: `package.json:21`, `scripts/deploy-remote.sh:4-7,47-64`.
- **Mismatch**
  - The root README says to keep SSH deploy config in a gitignored root `.env.deploy` and run `cp .env.deploy.example .env.deploy && npm run deploy`. The script's default is `$HOME/.gallerykit-secrets/gallery-deploy.env`; it never checks root `.env.deploy` unless the caller also sets `DEPLOY_ENV_FILE=.env.deploy`.
- **Failure scenario**
  - A maintainer follows the README exactly, edits `.env.deploy`, then runs `npm run deploy`. The command fails with “Missing deploy env file: ~/.gallerykit-secrets/gallery-deploy.env” even though the file the README told them to create exists.
- **Suggested fix**
  - Align the README with `.env.deploy.example` and the script default, or update `scripts/deploy-remote.sh` to prefer root `.env.deploy` when present before falling back to `$HOME/.gallerykit-secrets/gallery-deploy.env`.
- **Severity**: Medium
- **Confidence**: High

### 3) Quick-start docs do not warn that uploads become visible only after background processing completes

- **Files / regions**
  - Docs: `README.md:101-102`, `apps/web/README.md:21`.
  - Implementation: `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/lib/data.ts:338-345,483-510`, `apps/web/src/app/actions/images.ts:373-388`.
- **Mismatch**
  - The quick-start says to upload one photo and confirm the public homepage renders it. Public listing queries filter out unprocessed images by default, while upload actions enqueue image conversion asynchronously after inserting the row.
- **Failure scenario**
  - A new developer uploads a test photo, refreshes the homepage immediately, and sees an empty gallery while Sharp processing is still queued. They may assume upload or routing failed.
- **Suggested fix**
  - Add one sentence to both quick starts: uploads are processed asynchronously, so wait for processing to finish or refresh after a short delay before expecting the public homepage to show the photo.
- **Severity**: Medium
- **Confidence**: High

### 4) Upload docs omit the hard 1 GiB free-space precheck

- **Files / regions**
  - Docs: `README.md:131-145`, `apps/web/README.md:40-43`, `apps/web/.env.local.example:41-44`.
  - Implementation: `apps/web/src/app/actions/images.ts:203-215`.
- **Mismatch**
  - The docs cover batch byte/file-count limits and reverse-proxy body caps, but not the separate server-side requirement that the original-upload volume must have at least 1 GiB free before uploads are accepted.
- **Failure scenario**
  - An operator sizes `UPLOAD_MAX_TOTAL_BYTES`, nginx body caps, and file-count limits correctly, but uploads still fail with `insufficientDiskSpace` on a nearly full volume. The documented limits appear satisfied, so the failure is hard to diagnose.
- **Suggested fix**
  - Document the 1 GiB minimum free-space precheck beside upload limits and deployment storage notes.
- **Severity**: Medium
- **Confidence**: High

### 5) Settings docs miss that `image_sizes` and `strip_gps_on_upload` are locked once images exist

- **Files / regions**
  - Docs: `README.md:31-39`, `CLAUDE.md:174-184,197-198`, `apps/web/README.md:34-46`.
  - Implementation: `apps/web/src/lib/gallery-config-shared.ts:10-57`, `apps/web/src/app/actions/settings.ts:75-139`, UI hint in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:143-184`.
- **Mismatch**
  - Docs describe configurable image sizes and GPS stripping, and CLAUDE mentions upload-processing contract locks, but operator-facing docs do not state that these settings are effectively write-once after any image row exists.
- **Failure scenario**
  - A maintainer uploads photos first, then tries to change derivative sizes or turn GPS stripping on/off. Saving fails with `imageSizesLocked` or `uploadSettingsLocked`, which is surprising without an operational note.
- **Suggested fix**
  - Add a setup/deployment note that `image_sizes` and `strip_gps_on_upload` should be finalized before first upload, or require regenerating/clearing the library to change them later.
- **Severity**: Medium
- **Confidence**: High

### 6) SEO docs omit the same-origin / relative-only restriction on custom OG image URLs

- **Files / regions**
  - Docs: `README.md:43-56`, `apps/web/README.md:36-38`, `CLAUDE.md:86-99`.
  - Implementation: `apps/web/src/lib/seo-og-url.ts:3-30`, `apps/web/src/app/actions/seo.ts:137-143`.
- **Mismatch**
  - The docs say admins can edit the OG image URL, but do not say that accepted values are limited to root-relative paths or absolute URLs with the same origin as the configured site URL.
- **Failure scenario**
  - An admin pastes a CDN-hosted or third-party image URL into the OG image setting. The form rejects it with `seoOgImageUrlInvalid`, even though the public docs only say “OG image URL” and do not describe the restriction.
- **Suggested fix**
  - Document the accepted OG image URL shapes and, if external CDN OG images are intended, update validation/CSP behavior deliberately rather than leaving docs broad.
- **Severity**: Medium
- **Confidence**: High

### 7) Docker deployment docs omit that the container runs migrations before starting the server

- **Files / regions**
  - Docs: `README.md:165-181`, `apps/web/README.md:34-46`, `apps/web/deploy.sh:27-34`.
  - Implementation: `apps/web/Dockerfile:89-90`, `apps/web/scripts/migrate.js:525-555`.
- **Mismatch**
  - Deployment docs explain build/start commands but do not mention that the production container command runs `node apps/web/scripts/migrate.js` before `node apps/web/server.js` on every container start.
- **Failure scenario**
  - An operator restarts the container expecting only a process restart, but startup blocks or fails because MySQL is unavailable, credentials are wrong, or a migration fails. Without docs, the failure looks like a server boot problem instead of a migration preflight.
- **Suggested fix**
  - Add a Docker note: container startup applies committed migrations and seeds the initial admin if needed before launching Next.js.
- **Severity**: Medium
- **Confidence**: High

### 8) Upload docs mention the 2 GiB batch cap but not the fixed 200 MiB per-file cap

- **Files / regions**
  - Docs: `README.md:131-145`, `apps/web/README.md:40-41`, `apps/web/.env.local.example:41-44`.
  - Implementation: `apps/web/src/lib/upload-limits.ts:1-4`, `apps/web/src/components/upload-dropzone.tsx:43-47`.
- **Mismatch**
  - Operator docs emphasize the 2 GiB total batch budget but do not surface the independent 200 MiB per-file limit. CLAUDE notes it at `CLAUDE.md:216-219`, but user-facing README/env docs do not.
- **Failure scenario**
  - An operator raises/validates the 2 GiB batch budget and tries a single 500 MiB panorama/video-like image. The client/server reject it because `MAX_UPLOAD_FILE_BYTES` is hard-coded at 200 MiB, which is not discoverable from the public setup docs.
- **Suggested fix**
  - Add “200 MiB per file” wherever upload limits are documented and clarify that `UPLOAD_MAX_TOTAL_BYTES` does not raise the per-file cap.
- **Severity**: Low
- **Confidence**: High

### 9) `session.ts` contains a misleading “Dev-only fallback” comment

- **Files / regions**
  - Comment: `apps/web/src/lib/session.ts:30-45`.
- **Mismatch**
  - The code refuses DB-stored session-secret fallback only when `NODE_ENV === 'production'`, so the fallback applies to all non-production environments, not just development.
- **Failure scenario**
  - A maintainer reads “Dev-only fallback” and assumes tests or other non-production environments never use the DB-backed secret path, masking accidental DB coupling or secret-handling regressions.
- **Suggested fix**
  - Rename the comment to “Non-production fallback” or narrow the condition to development if that was intended.
- **Severity**: Low
- **Confidence**: High

## Final sweep

- Checked README/CLAUDE/apps-web README claims against package scripts, env examples, Dockerfile/Compose, deploy helpers, nginx config, site config, and key runtime code paths.
- Confirmed that the docs are accurate on several important points: Node 24+/Next 16/React 19/TS 6 package versions, local-only storage as the supported backend, host-network Docker topology, `TRUST_PROXY` requirements, liveness endpoint `/api/live`, `IMAGE_BASE_URL` validation/Compose build arg forwarding, private originals plus public derivatives, and GA configuration through `site-config.json` with CSP support.
- Did not modify source files or run broad test gates; this continuation is a docs-vs-code review artifact only.
