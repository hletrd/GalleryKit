# Cycle 38 Debugger Review

Role lane: cycle-38 debugger
Date: 2026-07-08 17:43 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `5c6a45a5a361c55f6ac615b8314496256a477a35`
Status: review-only. No production code was edited.

## Provenance

- Read first, per instruction: `AGENTS.md`, `CLAUDE.md`.
- Skill surface used: `code-review` (`/Users/hletrd/.agents/skills/code-review/SKILL.md`) for comprehensive review stance.
- Inventory commands included `rg --files`, `find`, targeted `rg -n` sweeps for server actions, route handlers, async/error paths, filesystem/path handling, browser globals, rate limits, restore maintenance, upload/delete cleanup, migrations, and build/runtime config.
- Bug-relevant inventory size after excluding generated/dependency directories: 635 `apps/web/src` files, 621 test/e2e files, 119 config/script/migration files, and 221 public/static files.

## Inventory Reviewed

- Upload/processing/delete/restore: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Database/schema/migrations/scripts: `apps/web/src/db/*`, `apps/web/drizzle/*`, `apps/web/scripts/migrate.js`, backfill scripts, seed/e2e helpers, deployment scripts.
- Public/admin routes and UI runtime surfaces: `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/proxy.ts`, upload serving routes, semantic/similar search routes, OG/feed/sitemap routes.
- Cross-cutting failure controls: auth/session, same-origin checks, rate limits, advisory locks, restore maintenance, admin mutation barrier, revalidation, service worker cache code, Docker/Next config.

## Confirmed Issues

No confirmed current source-level bugs were found. The review did identify likely issues and manual-validation risks below.

## Likely Issues

### L1: GPS stripping can double-buffer near-limit uploads and create process-level memory pressure

- Severity: Medium
- Confidence: Medium
- Classification: Likely issue
- File / region:
  - `apps/web/src/lib/upload-limits.ts:1-4` allows 200 MiB image uploads.
  - `apps/web/src/app/actions/images.ts:369-381` calls `stripGpsFromOriginal(...)` during browser uploads when `stripGpsOnUpload` is enabled.
  - `apps/web/src/lib/process-image.ts:1725-1730` reads the entire original file into memory before deciding whether a lossless scrub or Sharp fallback is needed.
  - `apps/web/src/lib/process-image.ts:1760-1799` may then run a Sharp re-encode fallback against the same file.
- Failure scenario: an admin uploads a near-200 MiB JPEG/TIFF/WebP/AVIF/HEIC while GPS stripping is enabled. The request has already streamed the original to disk, then `stripGpsFromOriginal` allocates a full-file `Buffer`; malformed containers can also hit the Sharp fallback. Under concurrent background image processing, CLIP work, or a memory-constrained container, this can turn a valid upload into RSS spikes, OOM kills, generic upload failure, or container restart. The upload pipeline serializes some paths, but it does not reserve process memory for this full-buffer scrub.
- Concrete fix: avoid whole-file buffering on the hot path. Prefer fd/range-based lossless scrubbers for JPEG/TIFF/WebP/ISOBMFF, or move GPS stripping into a bounded sidecar/subprocess with a strict memory limit and clear failure result. At minimum, add a memory-budget guard and lower effective upload caps when `strip_gps_on_upload=true`, with tests for near-cap files and malformed metadata.

### L2: `uploadImages` exposes a plural-file contract that exceeds the configured Server Action transport cap

- Severity: Low
- Confidence: Medium
- Classification: Likely issue / build-runtime mismatch
- File / region:
  - `apps/web/src/app/actions/images.ts:106-143` accepts `formData.getAll('files')` and permits up to `UPLOAD_MAX_FILES_PER_WINDOW`.
  - `apps/web/src/app/actions/images.ts:197-208` enforces a 2 GiB per-call/cumulative application limit.
  - `apps/web/src/lib/upload-limits.ts:1-6` defines 2 GiB total upload budget but a default Server Action body cap of only `max(200 MiB file, 250 MiB restore) + 16 MiB`.
  - `apps/web/next.config.ts:111-119` applies that smaller cap to `experimental.serverActions.bodySizeLimit`.
  - Current browser UI is safe because `apps/web/src/components/upload-dropzone.tsx:240-297` sends exactly one file per action call.
- Failure scenario: the server action presents and tests a plural upload surface, but the framework parser rejects any direct/future same-origin caller that sends multiple files above about 266 MiB before `uploadImages` runs. That bypasses the action's localized `totalUploadSizeExceeded` / cumulative quota logic and produces a framework-level failure. The shipped UI currently avoids this by per-file calls, so this is latent rather than user-visible today.
- Concrete fix: make the contract explicit. Either reject `files.length !== 1` in `uploadImages` and rename comments/tests around per-file invocation, or move large/multi-file browser upload to an API route with pre-parse `Content-Length` checks like the Lightroom path. Do not raise the Server Action cap to 2 GiB without a separate memory and DoS review.

## Manual-Validation Risks

### M1: Proxy origin fallback can deny legitimate same-origin actions in non-shipped proxy topology

- Severity: Medium
- Confidence: High for source behavior; manual validation required for live topology
- Classification: Manual-validation risk
- File / region:
  - `apps/web/src/lib/request-origin.ts:81-107` uses configured `BASE_URL` / `siteConfig.url` first, then falls back to `Host` before `X-Forwarded-Host` even when `TRUST_PROXY=true`.
  - `apps/web/docker-compose.yml:20-22` sets `TRUST_PROXY=true` for the shipped container.
  - `apps/web/src/lib/request-origin.ts:92-97` documents that the fallback order only works when shipped nginx keeps `Host` and `X-Forwarded-Host` aligned.
- Failure scenario: production lacks `BASE_URL`/valid `siteConfig.url`, and a CDN/LB/proxy forwards public `X-Forwarded-Host` but leaves `Host` as an internal upstream such as `127.0.0.1:3000` or `gallerykit-web`. Same-origin checks compare browser `Origin: https://public.example` to the internal `Host` origin and reject login, uploads, restores, and all mutating admin actions as unauthorized.
- Concrete fix: enforce a canonical origin at boot/deploy for production, or when `TRUST_PROXY=true` and no configured base origin exists, prefer trusted `X-Forwarded-Host` over `Host`. Add an integration test for divergent `Host` / `X-Forwarded-Host` with `TRUST_PROXY=true`.

### M2: Missing `TRUST_PROXY` collapses all rate limits into the `unknown` bucket

- Severity: Medium
- Confidence: High for source behavior; manual validation required for deployment state
- Classification: Manual-validation risk
- File / region:
  - `apps/web/src/lib/rate-limit.ts:175-216` trusts forwarded IP headers only when `TRUST_PROXY=true`; otherwise it returns `unknown` and logs a security warning if proxy headers are present.
  - `apps/web/docker-compose.yml:20-22` sets `TRUST_PROXY=true`, but runtime env/deploy drift can still be validated only on the live host.
- Failure scenario: a production deploy behind nginx/CDN runs without `TRUST_PROXY=true`. Five failed login attempts from any client can lock every user into the same `unknown` login bucket for the window; public/search/share/OG budgets can also be shared globally rather than per client.
- Concrete fix: make the production startup fail closed when proxy headers are present and `TRUST_PROXY` is unset, or expose a health/config diagnostic that verifies `getClientIp` against a known forwarded chain during deploy.

## Important Non-Findings

- Restore/import has broad drain coverage: `apps/web/src/app/[locale]/admin/db-actions.ts:571-785` starts durable maintenance, drains shared-group view counts, image queue, background writes, maintenance sweeps, and foreground admin mutations, then releases locks/finalizes maintenance.
- Pending file deletion is recoverable: `apps/web/src/app/actions/images.ts:680-728` and `apps/web/src/app/actions/images.ts:858-883` record pending cleanup rows before DB deletion; `apps/web/src/lib/pending-file-deletions.ts:82-139` retries; `apps/web/src/lib/maintenance-scheduler.ts:35-49` runs the cleanup on startup/hourly sweeps.
- Public upload serving has path/fd containment: `apps/web/src/lib/upload-paths.ts:120-167` rejects unsafe original names and symlinks; `apps/web/src/lib/serve-upload.ts:304-369` opens and stats the same fd for GET and destroys streams on abort.
- Migration runner guards the non-monotonic journal history: `apps/web/scripts/migrate.js:880-897` bootstraps fresh DBs through reconcile/baseline, and `apps/web/scripts/migrate.js:968-992` asserts every committed journal hash is recorded.
- Client browser globals are mostly isolated to client components/effects. Example: `apps/web/src/components/search.tsx:371-379` declares the body-scroll hook before the early return, and `apps/web/src/components/search.tsx:577` only portals after the client-side open path.

## Final Missed-Issue Sweep

Final sweep checked: null/undefined assumptions in upload/search/admin actions, async `.catch`/`finally` paths, restore/upload/delete races, advisory lock acquire/release failure handling, path traversal/symlink containment, DB migration cursor behavior, browser global usage, service worker cache expiry, Next/Docker/native package config, and rate-limit rollback semantics.

Relevant files skipped: no tracked source/config/migration/script category was intentionally skipped. Binary/static assets, generated/dependency output (`node_modules`, `.next`, coverage), archived screenshots, and local secret/env contents were not manually decoded. Tests were inventoried and used as contract evidence; the deep line review prioritized production code, migrations, scripts, config, and high-risk test contracts.
