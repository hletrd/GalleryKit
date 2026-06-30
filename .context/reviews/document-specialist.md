# Document Specialist Review - Cycle 25

Date: 2026-06-30 KST
Role: cycle-25 document-specialist
HEAD reviewed: `4cb1258ba0b2cca689846a85423264edc2d96b90`
Write policy: report-only; no commit or push performed.

## File Inventory

Loaded first, per instruction:
- `AGENTS.md`
- `CLAUDE.md`

Primary active documentation reviewed against source:
- `README.md`
- `apps/web/README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `.omc/wiki/clip-semantic-search-us-p51.md`
- `.omc/wiki/deploy-disk-hygiene-runbook.md`
- `.omc/wiki/admin-operator-guide.md`
- `.omc/wiki/deployment-remote-ops.md`
- `.omc/wiki/*.md`
- `docs/**/*.md`
- `.context/**/*.md`

Authoritative source and behavior anchors inspected:
- Root package scripts: `package.json`
- App scripts and package gates: `apps/web/package.json`
- Deployment helpers: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/next.config.ts`
- Environment loading and examples: `apps/web/src/lib/env.ts`, `apps/web/.env.local.example`, `.env.deploy.example`
- Migration and schema behavior: `apps/web/scripts/migrate.js`, `apps/web/drizzle/**/*.sql`, `apps/web/drizzle/meta/_journal.json`
- Admin API auth and public API rate-limit surfaces under `apps/web/src/app/api/**/route.ts`
- Mutating server actions under `apps/web/src/**/actions*.ts`
- Upload limits and image processing: `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-processing.ts`, `apps/web/src/lib/image-processing.ts`, admin upload routes
- Semantic search implementation: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/semantic-search/**`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/verify-clip-embeddings.ts`

Inventory counts used for the sweep:
- Documentation/env/deploy candidates excluding `.git`, `node_modules`, `.claude`, `apps/web/.next`, and test artifacts: 2473 files
- `.context` markdown files outside generated gate logs: 2169 files
- `docs` plus `.omc/wiki` markdown files: 18 files

Historical `.context` reviews/plans were inventoried and keyword-swept, but active operational docs, runbooks, READMEs, env examples, and source files were treated as the authoritative review surface. Old review artifacts were not treated as current operator instructions unless they described still-active behavior.

## Confirmed Doc/Code Mismatches

### DOC25-01 - PAT/LR Upload Docs Advertise Metadata Fields The Route Ignores

Severity: Medium
Confidence: High

Doc evidence:
- `README.md:214` says the PAT upload API accepts `topic` plus optional `title`, `description`, `tags`, `camera_model`, `lens_model`, `capture_date`, and exposure fields accepted by the admin upload path.
- `apps/web/README.md:87` says the multipart body includes `file`, `topic`, and optional metadata fields matching the dashboard upload form.

Source evidence:
- `apps/web/src/app/api/admin/lr/upload/route.ts:161` reads `const file = formData.get("file");`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:188` reads `const rawTopic = formData.get("topic");`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:194` reads `const rawTitle = formData.get("title");`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:195` reads `const rawDescription = formData.get("description");`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:404` through `apps/web/src/app/api/admin/lr/upload/route.ts:452` insert only route-provided `title`, `description`, `topic`, generated filenames, dimensions, and EXIF-derived fields; the documented `tags`, camera/lens model overrides, capture date, and exposure fields are not consumed from the form body.

Mismatch:
The docs describe the PAT/LR endpoint as accepting the dashboard upload metadata surface. The route currently supports only `file`, `topic`, optional `title`, and optional `description`, with camera/lens/date/exposure coming from EXIF extraction rather than documented form fields.

Concrete failure scenario:
A Lightroom or automation client follows `README.md`, sends `tags`, `camera_model`, `lens_model`, `capture_date`, and exposure values, receives a successful `201`, and assumes those fields were persisted. The image lands without the submitted tags or metadata overrides, producing missing search/filter data while the integration reports success.

Suggested fix:
Either narrow both docs to the current contract (`file`, `topic`, optional `title`, optional `description`) or extend `apps/web/src/app/api/admin/lr/upload/route.ts` to parse, validate, persist, and test the documented metadata fields. If extending the route, document whether provided values override EXIF or only fill EXIF gaps.

### DOC25-02 - PAT/LR Upload Docs Promise Processed Filenames Not Returned By The API

Severity: Medium
Confidence: High

Doc evidence:
- `README.md:216` says successful PAT uploads return JSON with the created image ID and processed filenames.
- `apps/web/README.md:89` says successful PAT uploads return JSON describing the created image and generated filenames.

Source evidence:
- `apps/web/src/app/api/admin/lr/upload/route.ts:544` returns `NextResponse.json(`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:545` returns exactly `{ success: true, id: imageId }`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:546` sets status `201`.

Mismatch:
The documented response includes generated filenames, but the current route response exposes only `success` and `id`.

Concrete failure scenario:
An external upload client reads the docs and tries to build derivative URLs or update a publish manifest from returned filenames. The upload succeeds, but filename fields are `undefined`, so the client either records broken asset URLs or treats a successful upload as a failed/partial publish.

Suggested fix:
Update the docs to show the exact current response shape:

```json
{ "success": true, "id": 123 }
```

If clients need filenames, add them deliberately to the route response and lock the contract with a route-level test.

### DOC25-03 - CLIP Semantic-Search Wiki Omits Required `--force` In Pre-Enable Backfill

Severity: High
Confidence: High

Doc evidence:
- `.omc/wiki/clip-semantic-search-us-p51.md:35` instructs operators to run `scripts/backfill-clip-embeddings.ts --production` during activation.

Source evidence:
- `apps/web/scripts/backfill-clip-embeddings.ts:6` documents pre-enable real encoder usage as `tsx scripts/backfill-clip-embeddings.ts --production --force`.
- `apps/web/scripts/backfill-clip-embeddings.ts:55` through `apps/web/scripts/backfill-clip-embeddings.ts:63` explain that `--force` skips the feature-flag gate and that plain `--production` is only appropriate after `semantic_search_mode` is already `stub` or `production`.
- `apps/web/scripts/backfill-clip-embeddings.ts:111` through `apps/web/scripts/backfill-clip-embeddings.ts:116` exit successfully without processing when `semantic_search_mode` is disabled and `--force` is absent.
- `CLAUDE.md:537` documents that the pre-enable flow requires `--production --force` because a fresh DB has semantic search disabled.
- `apps/web/README.md:77` also documents `tsx scripts/backfill-clip-embeddings.ts --production --force`.

Mismatch:
The wiki activation runbook gives an outdated pre-enable command. Current code intentionally no-ops with exit code 0 when semantic search is disabled and `--force` is not passed.

Concrete failure scenario:
An operator follows the wiki, runs the documented command before enabling production mode, sees a successful exit, and proceeds to enable `semantic_search_mode=production`. No real embeddings were generated, so semantic search returns empty/503-like behavior for production traffic until the backfill is rerun correctly. Because the wrong command exits 0, deploy automation or manual operators can miss the failure.

Suggested fix:
Change `.omc/wiki/clip-semantic-search-us-p51.md:35` to:

```bash
docker compose run --rm -e CLIP_BACKEND_URL=... -e CLIP_BACKEND_TOKEN=... web npx tsx scripts/backfill-clip-embeddings.ts --production --force
```

Also add the existing note from `CLAUDE.md` that `--force` is required before enabling the feature flag, and that operators should repeat with `SEMANTIC_SCAN_LIMIT` until no truncation message appears.

### DOC25-04 - Disk-Hygiene Wiki Overstates The `public` Bind Mount

Severity: Low
Confidence: High

Doc evidence:
- `.omc/wiki/deploy-disk-hygiene-runbook.md:22` says the persistent bind mounts are `./data`, `./public`, and `site-config.json`.

Source evidence:
- `apps/web/docker-compose.yml:24` mounts `./data:/app/data`.
- `apps/web/docker-compose.yml:25` mounts `./public/uploads:/app/public/uploads`.
- `apps/web/docker-compose.yml:26` mounts `./public/resources:/app/public/resources`.
- `apps/web/docker-compose.yml:27` mounts `./src/site-config.json:/app/src/site-config.json:ro`.
- `apps/web/deploy.sh:39` through `apps/web/deploy.sh:45` describe the same narrower mounts and state immutable public assets come from the image.
- `AGENTS.md:19` and `CLAUDE.md:474` also describe `./public/uploads` and `./public/resources`, not all of `./public`.

Mismatch:
The runbook broadens the persistent mount from the two mutable public subdirectories to the entire `public` directory.

Concrete failure scenario:
An operator believes any host-side file under `apps/web/public` is persistent across deploys and manually places custom static assets outside `uploads` or `resources`. Those assets are not bind-mounted into the live app and can disappear or diverge after the next image build/deploy, while the runbook suggests they should persist.

Suggested fix:
Replace `.omc/wiki/deploy-disk-hygiene-runbook.md:22` with the precise mount list: `./data`, `./public/uploads`, `./public/resources`, and read-only `./src/site-config.json`. Add that other `public` assets are immutable image contents.

## Verified Clean Areas

- Root and app quality-gate docs match package scripts: lint, admin API auth lint, action-origin lint, public route rate-limit lint, typecheck, build, unit tests, and e2e script names are present in `apps/web/package.json`.
- Remote deploy documentation matches `scripts/deploy-remote.sh`: root `.env.deploy` is preferred, app `.env.deploy` is a compatibility fallback, permissions are checked, and the remote command is derived from config rather than hardcoded in docs.
- Disk cleanup policy mostly matches source: `apps/web/deploy.sh` prunes containers, images, builder cache, and dangling volumes after `up -d`, and does not use `volume prune -a`.
- Upload/body-size documentation matches current limits: app upload cap defaults to 200 MiB, server-action body cap defaults to 266 MiB, nginx dashboard/LR upload caps are 216M, and DB restore cap is 250M.
- Legacy public-original startup/migration behavior is accurately documented: migration moves legacy originals and production startup asserts no legacy public originals remain.
- Semantic search endpoint posture matches current docs outside DOC25-03: same-origin checks, public rate-limit pre-increment, production-only gating for similar-image search, scan-limit behavior, and model-version filtering are reflected by source.
- Current env examples include semantic-search, upload/body-limit, cleanup concurrency, and backfill concurrency knobs; the older missing-`IMAGE_CLEANUP_CONCURRENCY` documentation issue appears fixed.
- Storage docs correctly describe local filesystem storage as the only live backend. No active doc was found claiming S3/R2 storage is currently implemented.
- Stripe/payment removal docs align with the current source tree; no active payment route or dependency was found.

## Final Missed-Issue Sweep

Performed a final targeted sweep for likely stale documentation terms and contracts:
- Upload API terms: `lr/upload`, `PAT`, `processed filenames`, `metadata`, `tags`, `camera_model`, `capture_date`
- Semantic-search terms: `CLIP`, `semantic_search_mode`, `--production`, `--force`, `SEMANTIC_SCAN_LIMIT`, `stub`, `production`
- Deployment terms: `deploy`, `.env.deploy`, `docker compose`, `prune`, `bind mount`, `public/uploads`, `public/resources`, `volume prune`
- Environment terms: `MAX_UPLOAD_FILE_BYTES`, `NEXT_UPLOAD_BODY_MAX_BYTES`, `IMAGE_CLEANUP_CONCURRENCY`, `BACKFILL_CONCURRENCY`, `ADMIN_BACKFILL_CONCURRENCY`
- Historical feature terms: `Stripe`, `payment`, `S3`, `R2`, `object storage`, `legacy originals`

No additional active doc/code mismatches rose to reportable confidence after checking the above against source behavior. The four findings above are the actionable mismatches found in this cycle.

Validation note: this was a documentation review. I did not run the full app test suite because no application code was changed and the requested deliverable is this report artifact.
