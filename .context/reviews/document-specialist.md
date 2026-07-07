# Cycle 16 Document-Specialist Review - 2026-07-08

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `d71a3534`.

Mode: static docs-vs-code review. I wrote only this assigned report artifact. I did not edit source, deploy, DB state, env files, containers, commits, or other review-lane reports. The worktree already contained unrelated edits in other `.context/reviews/*.md` files, which were left untouched.

## Inventory and Coverage

Authoritative docs and policy files examined:

- `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- `.context/plans/README.md`, current/historical `.context/plans/**`, current/historical `.context/reviews/**`, and root `plan/**`.
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.

Package, env, deploy, and runtime surfaces examined:

- `package.json`, `package-lock.json`, `apps/web/package.json`.
- `.env.deploy.example`, `apps/web/.env.local.example`.
- `scripts/deploy-remote.sh`, `scripts/check-proxy-topology.mjs`.
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.

Schema, scripts, source, and tests cross-checked against the docs:

- Migrations/schema: `apps/web/drizzle/**`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/init-db.ts`.
- CLIP semantic search: `apps/web/src/lib/clip-*.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, semantic routes/UI/settings/tests.
- Security/privacy: auth/session/origin/rate-limit helpers and lint scripts; `apps/web/src/lib/data.ts`; privacy guard tests.
- Color/HDR and storage: image processing/upload/serve paths, `apps/web/src/lib/storage/**`, upload-path/source-contract tests, color/HDR pipeline tests.
- Admin/public feature copy: `apps/web/messages/ko.json`, admin settings UI, search/similar-photo components, backup/restore admin routes/actions.

Repository markdown inventory from `git ls-files '*.md'`: `.context/plans` 267, `.context/reviews` 2138, `plan` 188, other markdown 8, total 2601. I treated current root/app docs, deploy docs, env examples, current indexes, and matching source/tests as authoritative. Historical plans/reviews were inventoried and keyword-swept for live-operator contradictions, then classified as historical unless a current index points to them as active.

Skipped deliberately: secret-bearing local env files (`.env.deploy`, `apps/web/.env.local`), generated/build artifacts, `node_modules`, live production database rows, seeded model weights, deployed nginx config, and deployed env values.

## Confirmed Issues

### DOC-C16-01 - Active plan index still advertises stale current-cycle state

- Severity: Medium
- Confidence: High
- File/code region: `.context/plans/README.md:34-40`, especially `cycle 15` at lines 36-37 and `cycle 7 (loop-B)` at lines 38-39; user task context says this review lane is Cycle 16 on 2026-07-08.
- Why this is a problem: the index is explicitly described as a convenience pointer for agents, but its "Active Current-Cycle Plans" section still tells agents that Cycle 15 and a loop-B Cycle 7 are active. That contradicts the current Cycle 16 review-plan-fix lane and makes the index unsafe as an orientation document.
- Concrete failure scenario: a later agent starts from `.context/plans/README.md`, resumes the listed Cycle 15 or Cycle 7 work instead of Cycle 16, and applies stale deferred/active findings as the current frontier. That can duplicate work, drop Cycle 16 review findings, or cause an implementation lane to target the wrong aggregate.
- Suggested fix: update `.context/plans/README.md` at the end of every cycle so exactly one active-current section points at the current cycle/aggregate/deferred register, with old entries moved to completed/historical. Prefer adding a generated timestamp/current HEAD/current cycle field to make stale indexes mechanically detectable.

### DOC-C16-02 - CLIP backfill script gives an incomplete production sidecar command

- Severity: Medium
- Confidence: High
- File/code region: `apps/web/scripts/backfill-clip-embeddings.ts:14-21` and production refusal at `apps/web/scripts/backfill-clip-embeddings.ts:115-118`; canonical command in `CLAUDE.md:581-593`.
- Why this is a problem: the script header's production `docker run` example runs `scripts/backfill-clip-embeddings.ts --production --force` but does not set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. The code refuses every `--production` run unless that env var is set. The canonical CLAUDE.md command includes `-e SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, so the two operator docs disagree.
- Concrete failure scenario: an operator copies the script-header command to pre-enable production embeddings. The sidecar starts, reaches the explicit guard, prints "Refusing --production without SEMANTIC_SEARCH_ALLOW_PRODUCTION=true.", exits non-zero, and no embeddings are written. If the operator misses the failure and later flips production mode, semantic routes return no usable production results.
- Suggested fix: make the inline command byte-for-byte consistent with CLAUDE.md by adding `-e SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, or remove the inline sidecar recipe and point operators to the single canonical CLIP runbook section in `CLAUDE.md`.

### DOC-C16-03 - Storage backend method comments still imply live pipeline integration

- Severity: Low
- Confidence: High
- File/code region: `apps/web/src/lib/storage/types.ts:51-72`; contradictory quarantine docs at `apps/web/src/lib/storage/types.ts:4-15`, `apps/web/src/lib/storage/index.ts:4-12`, and `CLAUDE.md:159`; non-test import check found no live `@/lib/storage` callers outside the storage module.
- Why this is a problem: the file header and CLAUDE.md correctly say the storage abstraction is experimental/local-only and not wired into upload, processing, or serving. The individual interface methods still say `writeStream` is "Used for upload pipeline", `writeBuffer` is "Used by Sharp output pipeline", and `createReadStream` is "Used by serve-upload.ts". Those statements are false for the current code.
- Concrete failure scenario: a maintainer or agent adds an S3/MinIO backend by implementing `StorageBackend`, believes the live upload/processing/serving pipeline will use it because the interface comments say so, and ships documentation or UI for remote storage. Production still writes/reads direct filesystem paths, so originals/derivatives stay local and the advertised backend silently does nothing.
- Suggested fix: rewrite the method comments to "intended/future use" wording, or remove live-pipeline references until the abstraction is wired end-to-end. Keep `CLAUDE.md:159` as the product boundary until non-test source imports prove integration.

## Likely Issues

No additional likely docs-vs-code contradictions were promoted. The remaining suspicious hits were either explicitly marked historical, already corrected by current root/app docs, or dependent on live production state that this static lane cannot validate.

## Manual-Validation Risks

### DOC-C16-MV-01 - CLIP activation docs describe the repository contract, not live production state

- Severity: Low
- Confidence: High
- File/code region: `CLAUDE.md:169`, `CLAUDE.md:602-611`, `README.md:48`, `apps/web/README.md:65-91`; code gates at `apps/web/src/lib/gallery-config-shared.ts` and `apps/web/src/lib/clip-model.ts`.
- Why this is a risk: docs are internally consistent that production CLIP requires seeded weights, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and a DB row. Static repo review cannot prove the deploy host has weights, env, or embeddings.
- Concrete failure scenario: an operator treats the repo/docs as proof that the live gallery already has semantic search active, but the host lacks model weights or the DB row remains disabled. Search returns setup/503 states despite documentation being accurate.
- Suggested fix: keep the existing wording that live row count/host state must be verified. For activation work, require the documented `npm run test:clip:preflight` plus a live admin/search smoke after deploy.

### DOC-C16-MV-02 - Proxy/nginx claims require host topology validation

- Severity: Low
- Confidence: High
- File/code region: `README.md:171-174`, `CLAUDE.md:97-98`, `apps/web/nginx/default.conf:59-71`, `scripts/check-proxy-topology.mjs`.
- Why this is a risk: checked-in docs and nginx config agree on the intended single trusted internal nginx hop, but the actual TLS edge/load-balancer configuration is outside the repository.
- Concrete failure scenario: a production edge appends or preserves untrusted `X-Forwarded-For` while the app trusts one hop, causing per-IP rate limits and same-origin checks to identify the wrong client/origin.
- Suggested fix: keep the docs, but run `npm run check:proxy-topology -- <url>` and inspect deployed nginx/edge headers whenever the reverse-proxy topology changes.

## Final Sweep

I re-swept for commonly missed documentation drift: package scripts vs README/AGENTS quality gates, deploy helper/env fallback, Docker bind mounts and auto-prune claims, migration journal/postcondition rules, DB SSL and upload/body-limit env docs, admin API/origin/rate-limit policy docs, privacy-sensitive field guards, CLIP semantic activation/backfill docs, color/HDR admin/public boundary, storage backend claims, service-worker/static upload cache policy, and stale plan/review context.

No confirmed contradictions were found in the main README/CLAUDE deploy, migration/schema, security/privacy, color/HDR, env var, or admin/public feature documentation beyond the three confirmed issues above. Historical CLIP spec/plan files are clearly labeled historical and point operators back to current README/CLAUDE runbooks, so I did not count their old snippets as active-documentation defects.
