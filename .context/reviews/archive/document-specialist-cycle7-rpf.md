# Document Specialist Review — Cycle 7 RPF

## Inventory / Coverage

I reviewed the current, docs-relevant source of truth rather than sampling:

### Top-level docs and workspace metadata
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `package.json`
- `.env.deploy.example`

### App-level docs, deployment, and config
- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/.env.local.example`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/src/site-config.example.json`

### Runtime code paths that the docs describe
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### Verification / reference tests
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/upload-limits.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`

### Final sweep
- I grep-swept the plan/review archive for current-behavior anchors (`TRUST_PROXY`, `X-Forwarded-Host`, `S3`, `MinIO`, `storage`, `queueConcurrency`, `upload limits`) to catch stale copy. I did not find any additional active-source drift beyond the issues below.

## Findings

### 1) Shipped proxy docs/config do not explicitly protect `X-Forwarded-Host`
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `README.md:148`, `apps/web/nginx/default.conf:45-56, 61-72, 112-121`, `apps/web/src/lib/request-origin.ts:19-24, 55-69, 83-106`

**Why this is a problem**
The root README correctly says the trusted proxy must overwrite `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. The shipped nginx config, however, only sets `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`; it never sets `X-Forwarded-Host`.

The code path for same-origin validation does trust `X-Forwarded-Host` when `TRUST_PROXY=true`, so a proxy that leaves that header untouched can feed attacker-controlled host data into admin-origin checks.

**Concrete failure scenario**
A reverse proxy chain forwards a client-supplied `X-Forwarded-Host` header unchanged. Admin login, password change, or DB-download requests are then evaluated against a host value the proxy never sanitized. That can undermine the same-origin boundary the docs promise.

**Suggested fix**
- Add `proxy_set_header X-Forwarded-Host $host;` to every proxy location in `apps/web/nginx/default.conf`.
- Mirror that requirement in the app README and env example so operators know the shipped proxy must sanitize all three headers, not just `Host` and `X-Forwarded-Proto`.

### 2) Settings localization still advertises removed admin controls
- **Severity:** Low
- **Confidence:** High
- **Status:** Confirmed
- **Files:** `apps/web/messages/en.json:544-569`, `apps/web/messages/ko.json:544-569`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:90-187`, `apps/web/src/app/actions/settings.ts:11-12, 49-77, 113-130`

**Why this is a problem**
The message catalogs still contain copy for settings sections that no longer exist in the rendered settings page:
- `queueConcurrency`
- `galleryDisplayTitle` / `columnsDesktop` / `columnsTablet` / `columnsMobile`
- `uploadLimitsTitle` / `maxFileSize` / `maxFilesBatch`
- `storageTitle` / `storageBackend` / `storageMinio` / `storageS3`

The current settings page only renders image-processing and privacy controls, and the settings action only accepts the corresponding image-processing/privacy keys. The leftover storage copy is especially misleading because `CLAUDE.md` explicitly says not to expose S3/MinIO switching as a supported feature yet.

**Concrete failure scenario**
A translator, screenshot-based doc generator, or support article pulls from the catalog and tells admins to look for Gallery Display, Upload Limits, or Storage Backend controls that are no longer in the UI. That creates avoidable operator confusion and makes the repo look like it still supports features it does not.

**Suggested fix**
- Remove the dead message keys, or
- Reintroduce the corresponding settings UI and server-action support before keeping the copy.

## Verification

- Targeted tests passed: `9/9` files, `42/42` tests
- Command run:
  - `npm run test --workspace=apps/web -- --run src/__tests__/request-origin.test.ts src/__tests__/mysql-cli-ssl.test.ts src/__tests__/next-config.test.ts src/__tests__/upload-limits.test.ts src/__tests__/health-route.test.ts src/__tests__/live-route.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/serve-upload.test.ts src/__tests__/gallery-config-shared.test.ts`

