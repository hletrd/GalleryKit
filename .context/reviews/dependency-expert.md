# Dependency Expert Review — Cycle 3

Scope: `/Users/hletrd/flash-shared/gallery`

## Inventory snapshot

- Workspace: single Next.js app under `apps/web` with monorepo root scripts.
- Core external SDKs/deps in use: Next 16.2.3, React 19.2.5, `next-intl`, AWS SDK v3 S3, Sharp, Argon2, MySQL2, Drizzle ORM/Kit, Playwright, Vitest, Radix UI primitives, Framer Motion, Sonner, `p-queue`.
- Deployment surfaces inspected: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/storage/*`.

## Confirmed issues

| Severity | File / region | Finding | Failure scenario | Suggested fix | Confidence |
|---|---|---|---|---|---|
| High | `apps/web/src/lib/storage/s3.ts:95-115` | `writeStream()` fully buffers every upload into memory before calling `PutObjectCommand`. | Large uploads or multiple concurrent uploads can spike RSS and OOM the process before S3/MinIO ever sees the body. | Pass a stream directly to the AWS SDK or switch to multipart upload (`@aws-sdk/lib-storage` / streaming body) so upload size does not scale memory use linearly. | High |
| High | `apps/web/src/app/actions/auth.ts:5-7,210-216,215-230` | The auth action imports `isRedirectError` from `next/dist/client/components/redirect-error` (an internal Next path). | A Next.js minor/patch upgrade can move or rename that private module, breaking auth redirects or the build without any app code change. | Replace the internal import with the documented public pattern for framework control-flow errors. If `try/catch` must stay around redirecting code, use the documented `unstable_rethrow` pattern instead of a private module import. | High |
| Medium | `apps/web/package.json:56-73` + `apps/web/Dockerfile:3-10` | Dead dependency + native toolchain bloat: `better-sqlite3`, `@types/better-sqlite3`, and `@vitejs/plugin-react` are declared but not referenced anywhere in the repo, while the Docker image still installs `python3 make g++` “for sharp and better-sqlite3”. | The production image pays for native build tooling it does not appear to need, increasing image size, build time, and native-compilation failure surface. | Remove the unused packages and the sqlite build toolchain unless a real import is added later. If SQLite support is still desired for a future path, gate it behind an optional package/install step instead of baking it into the default image. | Medium-High |

## Risks / operational hazards

| Severity | File / region | Risk | Failure scenario | Suggested fix | Confidence |
|---|---|---|---|---|---|
| Medium | `apps/web/src/lib/storage/s3.ts:80-87` | Auto-creating S3 buckets omits `CreateBucketConfiguration` / region location constraint. | AWS S3 bucket bootstrap will fail outside `us-east-1` unless the bucket already exists; this works locally with MinIO but can break first deploys to AWS or other region-aware S3 backends. | Include the region-specific location constraint when `S3_REGION !== 'us-east-1'`, or remove auto-create and provision buckets out of band. | High |
| Medium | `apps/web/docker-compose.yml:10-22` | `network_mode: host` plus host-managed MySQL and bind mounts make the deployment Linux/Desktop-specific. | The compose stack is fragile on Docker Desktop and non-Linux targets; host networking may not work or may require extra Desktop settings, and the host DB assumption is easy to misconfigure. | Keep this as an explicitly Linux-only deployment path, or move to bridge networking / service DNS and document the port and reverse-proxy setup accordingly. | Medium |
| Medium | `apps/web/src/db/index.ts:5-24` | MySQL TLS is auto-enabled for all non-localhost DB hosts with `rejectUnauthorized: true`. | Self-signed or private-CA MySQL endpoints will fail to connect unless `DB_SSL=false` is set, which is easy to miss during deployment. | Add a CA-configurable TLS mode (`DB_SSL_CA` / `DB_SSL_MODE`) or document the certificate requirement prominently in the deployment guide. | Medium |

## Missed-issues sweep

Final sweep checked for:
- unused external packages across source, scripts, tests, and configs,
- private/unstable framework imports,
- Docker/deployment assumptions that conflict with the runtime environment,
- S3 region/bootstrap behavior that differs between MinIO and AWS,
- memory-heavy upload paths.

No additional high-confidence issues surfaced beyond the items above.

## References

- Next.js redirect / framework control-flow docs: https://nextjs.org/docs/app/api-reference/functions/redirect
- Next.js `unstable_rethrow` docs: https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow
- AWS S3 bucket creation docs: https://docs.aws.amazon.com/AmazonS3/latest/user-guide/create-bucket.html
- AWS S3 CreateBucketConfiguration reference: https://docs.aws.amazon.com/AmazonS3/latest/API/API_control_CreateBucketConfiguration.html
- Docker host networking docs: https://docs.docker.com/engine/network/tutorials/host/
