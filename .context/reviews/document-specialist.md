# Document Specialist Review — Cycle 4 (Prompt 1)

## Scope
I reviewed the authoritative docs and config surfaces against current code, focusing on:

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `apps/web/README.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/next.config.ts`
- `apps/web/.env.local.example`
- `.context/plans/README.md`
- `.context/plans/plan-112-admin-settings-page.md`
- `.context/plans/plan-113-minio-s3-storage.md`
- `.context/reviews/cycle6-r2-critic.md`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

Package scripts and Docker config were checked as well; they largely align with the code paths they reference. The issues below are concentrated in stale plan/review artifacts and a few missing operator warnings.

## Findings summary

| ID | Severity | Status | Summary |
|---|---|---|---|
| DS-04-01 | Medium | confirmed | Stale settings-surface docs and locale copy still describe UI controls that no longer exist. |
| DS-04-02 | Medium | confirmed | Queue concurrency is real code, but the operator-facing docs still do not document the actual `QUEUE_CONCURRENCY` knob. |
| DS-04-03 | Medium | confirmed | `IMAGE_BASE_URL` docs miss the exact URL-shape constraints enforced by `next.config.ts`. |
| DS-04-04 | Medium | confirmed | Top-level docs omit the default-TLS / `DB_SSL=false` behavior for non-local MySQL hosts. |

## Detailed findings

### DS-04-01 — Stale settings-surface docs and locale copy describe controls that are no longer present
**Severity:** Medium
**Status:** confirmed
**Confidence:** High
**Files / regions:** `.context/plans/plan-112-admin-settings-page.md:10-64`, `.context/plans/plan-113-minio-s3-storage.md:10-78`, `.context/reviews/cycle6-r2-critic.md:24-28`, `apps/web/messages/en.json:543-556`, `apps/web/messages/ko.json:543-556` vs `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-178`, `apps/web/src/lib/gallery-config-shared.ts:10-19`, `apps/web/src/lib/upload-limits.ts:1-12`, `apps/web/src/lib/storage/index.ts:1-18`

The current settings UI only renders image quality, image sizes, and the GPS privacy toggle. The live setting key list is five entries:

- `image_quality_webp`
- `image_quality_avif`
- `image_quality_jpeg`
- `image_sizes`
- `strip_gps_on_upload`

But the plan/review artifacts still describe a much broader settings surface: queue concurrency, upload limits, display columns, and a storage-backend switch. The locale catalogs still contain matching headings and hints for Upload Limits and Storage Backend even though those sections are not rendered by the current settings page and the corresponding values are env-only or experimental.

**Concrete failure scenario:** a maintainer or translator consults the active plan/review docs and expects to find UI controls for queue concurrency or storage backend switching. They spend time debugging a missing setting rather than recognizing that those knobs are not part of the current admin surface.

**Suggested fix:** mark the stale plan/review files as historical or rewrite them to the current contract; remove dead locale copy or wire the UI if those sections are meant to exist; keep the current settings contract documented as only the five live keys above.

### DS-04-02 — Queue concurrency is real code, but the operator-facing docs do not document the actual env knob
**Severity:** Medium
**Status:** confirmed
**Confidence:** High
**Files / regions:** `apps/web/src/lib/image-queue.ts:116-120`, `apps/web/.env.local.example:31-38`, `apps/web/README.md:34-43`, `README.md:118-145`

`image-queue.ts` still reads `process.env.QUEUE_CONCURRENCY` and falls back to `2`, but the onboarding docs and env example do not mention that knob. The env example documents `SHARP_CONCURRENCY`, which controls libvips worker threads, but not the queue concurrency that actually determines how many image jobs can run at once.

**Concrete failure scenario:** an operator increases `SHARP_CONCURRENCY` expecting uploads to process more quickly, but the queue still runs at the default parallelism because `QUEUE_CONCURRENCY` was never set. Throughput stays unchanged and the person tunes the wrong layer.

**Suggested fix:** add `QUEUE_CONCURRENCY` to `apps/web/.env.local.example` and the app/root README env notes, or explicitly say that queue parallelism is intentionally fixed and not an operator knob.

### DS-04-03 — `IMAGE_BASE_URL` docs miss the exact URL-shape constraints enforced by the build
**Severity:** Medium
**Status:** confirmed
**Confidence:** High
**Files / regions:** `README.md:140-141`, `apps/web/README.md:37-38`, `apps/web/next.config.ts:7-31`

The docs correctly say `IMAGE_BASE_URL` must be set before build time and should use HTTPS in production. The build, however, is stricter than the text makes clear: it requires an absolute `http(s)` URL and rejects credentials, query strings, and hashes entirely.

**Concrete failure scenario:** a deployer uses a signed CDN URL or a URL with embedded credentials/query params. Local testing may look fine until `next build` fails with a validation error, blocking the image build step.

**Suggested fix:** extend the `IMAGE_BASE_URL` docs with the exact constraints: absolute URL only, `http`/`https` only, HTTPS required in production, and no username/password/query/hash components.

### DS-04-04 — Top-level docs omit the default-TLS / `DB_SSL=false` behavior for non-local MySQL hosts
**Severity:** Medium
**Status:** confirmed
**Confidence:** High
**Files / regions:** `apps/web/scripts/mysql-connection-options.js:1-23`, `apps/web/.env.local.example:1-7`, `README.md:118-145`, `apps/web/README.md:34-41`

The MySQL connection helper automatically enables TLS for any non-localhost DB host unless `DB_SSL=false` is set. That behavior is only hinted in the env example comment; the higher-level README docs do not call it out.

**Concrete failure scenario:** an operator points the app at a remote MySQL instance and assumes plaintext or self-signed TLS will work the same way local MySQL does. The connection fails because the helper is trying to enforce TLS by default.

**Suggested fix:** add a short top-level note in README/CLAUDE/app README that non-local DB hosts default to TLS and that `DB_SSL=false` is the opt-out when the deployment intentionally uses a non-TLS or self-signed path.

## Reusable takeaway
The core code/docs contract is mostly aligned, especially for the Docker and script surfaces, but the docs still drift around the settings surface and a few environment-level knobs. The fastest cleanup path is to remove or relabel stale plan/review guidance, then patch the onboarding docs for the real env-only controls and URL/TLS constraints.
