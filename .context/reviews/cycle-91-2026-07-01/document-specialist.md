# Cycle 91 Document-Specialist Review

Scope: bounded documentation/code-contract review of deployed `master` at `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

No dedicated registered `document-specialist` agent was available in this bounded run. This is best-effort coverage from the architect/documentation lane.

## Inventory First

- Canonical project docs: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`.
- Active cycle/review docs: `.context/reviews/_aggregate.md`, `.context/plans/cycle-90-2026-07-01-plan.md`, `.context/plans/cycle-90-2026-07-01-deferred.md`.
- Documentation-sensitive code: `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, static `site-config` import consumers, semantic-search schema/routes/backfill docs, restore-maintenance docs/tests.

## Confirmed Documentation Findings

### C91-DOC-01 - Semantic embedding docs describe version-aware behavior, but the schema still makes version storage mutually exclusive

Severity: Medium
Confidence: High

Evidence:
- The active deferred ledger says the exit criterion is one row per `(image_id, model_version)` (`.context/plans/cycle-90-2026-07-01-deferred.md:16`).
- Current schema/migration still make `image_id` the sole primary key (`apps/web/src/db/schema.ts:284`, `apps/web/src/db/schema.ts:285`; `apps/web/drizzle/0012_image_embeddings.sql:10`).
- Search documentation and route comments are honest that serving filters on `model_version` (`apps/web/README.md:70`; `apps/web/src/app/api/search/semantic/route.ts:19`, `apps/web/src/app/api/search/semantic/route.ts:24`, `apps/web/src/app/api/search/semantic/route.ts:25`).
- The backfill script comment explicitly says an upsert replaces a different version in place (`apps/web/scripts/backfill-clip-embeddings.ts:27`, `apps/web/scripts/backfill-clip-embeddings.ts:29`, `apps/web/scripts/backfill-clip-embeddings.ts:37`, `apps/web/scripts/backfill-clip-embeddings.ts:40`).

Failure scenario:
- A future maintainer sees the route/docs emphasis that `model_version` separates stub and production rows and assumes rollback/canary is non-destructive. In reality, the single-row primary key means backfill replaces prior model rows and rollback requires another full re-embed.

Concrete fix:
- Until the schema migration lands, add an explicit operator note near the semantic-search runbook that `model_version` is a serving filter, not multi-version retention, and switching modes overwrites per-image rows.
- Preferred fix remains the schema migration to one row per `(image_id, model_version)`, then remove the warning.

## Likely / Manual-Validation Risks

### C91-DOC-RISK-01 - `site-config.json` docs mix rebuild-time and runtime-mount language

Severity: Medium
Confidence: Medium

Evidence:
- README says `BASE_URL` / `IMAGE_BASE_URL` are build-time-sensitive (`apps/web/README.md:47`, `apps/web/README.md:49`) and says `site-config.json` owns static links/analytics defaults (`apps/web/README.md:48`).
- The same README says the Docker topology has a host-side `src/site-config.json` bind mount (`apps/web/README.md:55`).
- CLAUDE says the JSON is read via static import and has static build-time values (`CLAUDE.md:663`, `CLAUDE.md:673`), but also lists `./src/site-config.json` as persisted runtime config in the Docker persistence model (`CLAUDE.md:477`).
- Compose does mount it at runtime (`apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:28`), while the Docker build validates it before `next build` (`apps/web/Dockerfile:96`, `apps/web/Dockerfile:97`; `apps/web/scripts/ensure-site-config.mjs:4`, `apps/web/scripts/ensure-site-config.mjs:11`).
- Code consumers statically import it in both client and server surfaces (`apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:72`; `apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147`; `apps/web/src/app/sitemap.ts:14`, `apps/web/src/app/sitemap.ts:18`).

Risk scenario:
- Operator edits the mounted host file and restarts the container expecting a runtime config update. Some values may be build-bundled, especially client-side `home_link` and GA script inclusion, so docs may send the operator down the wrong recovery path.

Concrete fix:
- Make the docs state one contract in every location:
  - Rebuild-only contract: remove the runtime-persistence framing for `src/site-config.json` and say edits require rebuild/deploy.
  - Runtime contract: replace static imports with a validated runtime loader and a client-safe propagation path.
- Add an operator note beside the Compose mount explaining why the mount exists if it is only a build/deploy file-presence guard.

## No Confirmed Doc Mismatch Found

- Restore-maintenance docs are aligned with the current known limitation: the active deferred ledger explicitly says foreground non-upload admin mutations are not fully fenced (`.context/plans/cycle-90-2026-07-01-deferred.md:18`), and CLAUDE documents recovery steps for stale durable markers (`CLAUDE.md:401`).
- Deploy/disk-prune docs match Compose/Docker persistence at the level reviewed: `docker-compose.yml` bind-mounts `data`, `public/uploads`, `public/resources`, and `src/site-config.json` (`apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:28`), matching the documented persistence list except for the site-config runtime ambiguity noted above.

## Missed-Issue Sweep

- Searched docs and source for `site-config`, `BASE_URL`, `IMAGE_BASE_URL`, runtime/build-time language, semantic `model_version`, restore maintenance, and active deferred markers.
- Checked docs against current schema, migrations, route comments, sidecar comments, Dockerfile, and Compose.
- Reviewed active Cycle 90 plan/deferred state so previously acknowledged limitations were not mistaken for undocumented surprises.

No additional confirmed document-specialist findings were found.
