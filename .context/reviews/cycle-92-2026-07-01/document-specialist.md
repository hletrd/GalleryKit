# Cycle 92 Document-Specialist Review

## Scope and method

Static review only. I read the project guidance (`AGENTS.md`, `CLAUDE.md`) and current `.context` plan/review guidance, then compared operator docs and source-contract ledgers against authoritative repository source for deploy policy, schema/migration policy, environment variables, semantic-search contracts, restore/maintenance rules, and test tripwires. I did not deploy, mutate production, run destructive Docker/database commands, or modify any file other than this report.

Local command evidence used with the file-line citations below:

- `git rev-parse HEAD` => `508d35572563705008693da2dbff3e5d85442cdd`.
- `git log -1 --oneline --decorate` => `508d355 (HEAD -> master, origin/master, origin/HEAD) docs(review): 📝 close cycle 91 release evidence`.
- `git show --stat --name-only -1` => the current HEAD changes only `.context/plans/README.md` and `.context/plans/cycle-91-2026-07-01-plan.md`.
- `apps/web/drizzle/meta/_journal.json` contains 29 entries; the current max `when` is `1782812037323` at `0028_rate_limit_bucket_start_idx` (`apps/web/drizzle/meta/_journal.json:201-205`).

## Inventory built first

### Guidance and ledgers

- `AGENTS.md`: deploy policy, schema policy, quality gates, review conventions (`AGENTS.md:17-27`, `AGENTS.md:31-45`).
- `CLAUDE.md`: stack/env variables (`CLAUDE.md:5-17`, `CLAUDE.md:71-119`), semantic-search schema and runbook (`CLAUDE.md:159`, `CLAUDE.md:501-566`), topology/pool/image pipeline (`CLAUDE.md:234-267`), ETag/source-contract notes (`CLAUDE.md:306-308`), backfill sidecar/no in-container npm install (`CLAUDE.md:335-363`, `CLAUDE.md:495-499`), restore/race protections (`CLAUDE.md:388-405`), migration runbook (`CLAUDE.md:424-448`), deploy/disk hygiene (`CLAUDE.md:465-499`), deprecated payment surfaces and important limits (`CLAUDE.md:582-595`), testing/lint gates (`CLAUDE.md:601-630`), deployment checklist (`CLAUDE.md:659-688`).
- `.context/plans/README.md`: current-cycle pointer and “do not infer from README alone” warning (`.context/plans/README.md:7-15`, `.context/plans/README.md:140-144`).
- `.context/plans/cycle-91-2026-07-01-plan.md`: Cycle 91 terminal release evidence (`.context/plans/cycle-91-2026-07-01-plan.md:61-75`).
- `.context/plans/cycle-91-2026-07-01-deferred.md`: carry-forward restore, embedding, site-config, and manual-validation risks (`.context/plans/cycle-91-2026-07-01-deferred.md:19-48`).
- `.context/reviews/_aggregate.md`: Cycle 91 aggregate/current risk ledger (`.context/reviews/_aggregate.md:51-70`).
- Existing Cycle 92 lane reports in `.context/reviews/cycle-92-2026-07-01/` were checked for overlap; this report re-validates only document/source-contract items with source lines.

### Public/operator docs

- `README.md`: product scope, config, install, deploy helper, build-time env caveats, nginx/upload limits, upload API, stack (`README.md:29-52`, `README.md:95-168`, `README.md:187-231`).
- `apps/web/README.md`: environment notes, semantic-search operator runbook, upload API (`apps/web/README.md:44-84`, `apps/web/README.md:90-99`).
- `.env.deploy.example`: deploy helper env contract (`.env.deploy.example:1-16`).
- `apps/web/.env.local.example`: runtime/build-time env examples, proxy, health, semantic search (`apps/web/.env.local.example:1-87`).

### Deploy/runtime source of truth

- Root scripts: `package.json` maps `npm run deploy` to `./scripts/deploy-remote.sh` (`package.json:11-22`).
- Deploy helper: env-file discovery, permission refusal, derived SSH command (`scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:31-53`, `scripts/deploy-remote.sh:55-93`).
- Host deploy script: fast-forward pull, `.env.local` permission check, `site-config.json` existence check, compose build/up, health gate, prune-after-up (`apps/web/deploy.sh:10-55`, `apps/web/deploy.sh:57-77`, `apps/web/deploy.sh:79-108`).
- Compose/Docker/nginx: build args and bind mounts (`apps/web/docker-compose.yml:4-28`), Node 24 image/runtime env and sidecar-compatible prod deps (`apps/web/Dockerfile:1-25`, `apps/web/Dockerfile:49-115`, `apps/web/Dockerfile:130-158`), request-body/proxy limits (`apps/web/nginx/default.conf:21-35`, `apps/web/nginx/default.conf:59-77`, `apps/web/nginx/default.conf:124-151`).

### Schema, migration, and source-contract ledgers

- Drizzle schema/migrations for `image_embeddings` (`apps/web/src/db/schema.ts:269-299`, `apps/web/drizzle/0012_image_embeddings.sql:1-12`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-10`).
- Migration runner/reconcile source and journal monotonicity ledgers (`apps/web/scripts/migrate.js:653-666`, `apps/web/scripts/migrate.js:720-824`, `apps/web/src/__tests__/migration-journal.test.ts:75-136`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-119`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:1-219`).
- Privacy/admin-only ledgers (`apps/web/src/lib/data.ts:375-404`, `apps/web/src/__tests__/privacy-fields.test.ts:7-45`, `apps/web/src/__tests__/privacy-fields.test.ts:72-93`).
- Color/settings-hash ledgers (`apps/web/src/lib/settings-hash.ts:44-55`, `apps/web/src/__tests__/settings-hash.test.ts:19-38`, `CLAUDE.md:306-308`).
- Semantic-search writers/readers (`apps/web/src/app/api/search/semantic/route.ts:19-30`, `apps/web/src/app/api/search/semantic/route.ts:263-290`, `apps/web/src/app/api/search/similar/[id]/route.ts:14-21`, `apps/web/src/app/api/search/similar/[id]/route.ts:132-177`, `apps/web/scripts/backfill-clip-embeddings.ts:25-42`, `apps/web/scripts/backfill-clip-embeddings.ts:161-183`, `apps/web/scripts/backfill-clip-embeddings.ts:205-223`, `apps/web/src/lib/image-queue.ts:352-390`, `apps/web/src/app/actions/embeddings.ts:3-10`, `apps/web/src/app/actions/embeddings.ts:95-140`, `apps/web/src/app/actions/embeddings.ts:166-177`).
- `site-config.json` build/runtime consumers (`apps/web/docker-compose.yml:24-28`, `apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:71-74`, `apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147-155`, `apps/web/src/app/sitemap.ts:14-18`).

## Confirmed issues

### C92-DOC-01 — Terminal release ledger does not evidence deployment of current pushed HEAD

- Severity: Medium
- Confidence: High
- Status: Confirmed documentation/evidence mismatch.

**Evidence**

- Project policy requires `npm run deploy` after every commit pushed to `master`; there is no staging (`AGENTS.md:17`, `CLAUDE.md:467-469`).
- Current local/remote HEAD is `508d35572563705008693da2dbff3e5d85442cdd` (`git rev-parse HEAD`; `git log -1 --oneline --decorate`).
- The Cycle 91 plan ledger starts from `c648634...` and records deploy/smoke only for signed `aacccbc99ccbafe473362c7daf9eaaaa44b6ccef` (`.context/plans/cycle-91-2026-07-01-plan.md:61-65`).
- The plan index likewise says Cycle 91 was committed/pushed/deployed as signed `aacccbc`, while Cycle 90 separately notes a docs-only terminal sync committed as `c648634` (`.context/plans/README.md:11-13`).
- The same index warns not to infer unresolved work from the README alone and to read the latest plan/deferred/aggregate (`.context/plans/README.md:140-144`), but none of those files record deploy/smoke evidence for `508d355`.

**Why this matters**

The authoritative repo state is now `origin/master == 508d355`, but the terminal release evidence stops one commit earlier at `aacccbc`. That can mislead the next operator/reviewer into believing the current pushed head has production evidence when the committed ledger only proves an earlier commit. This is especially risky because deployment is a required per-iteration policy, not optional bookkeeping.

**Suggested remediation**

Either deploy/smoke `508d355` and append exact evidence to the release ledger, or explicitly document a policy exception for docs-only evidence commits. The latter would be a policy change because `AGENTS.md:17` and `CLAUDE.md:469` currently say every pushed master commit is followed by deploy.

### C92-DOC-02 — Semantic-search operator docs still understate the one-row-per-image model-version overwrite behavior

- Severity: Medium
- Confidence: High
- Status: Confirmed carry-forward documentation/source-contract gap (`C91-04` / `C88-03`).

**Evidence**

- Public/operator docs correctly state that production serves only rows matching the active `model_version` and returns 503 if no real embeddings exist (`apps/web/README.md:66-70`).
- Route source matches that honesty gate: semantic search chooses the active model version (`apps/web/src/app/api/search/semantic/route.ts:202-204`), filters rows by that version (`apps/web/src/app/api/search/semantic/route.ts:263-279`), and returns `semantic_no_embeddings` for empty production rows (`apps/web/src/app/api/search/semantic/route.ts:285-290`). Similar-photo search is production-only and also filters by `PRODUCTION_MODEL_VERSION` (`apps/web/src/app/api/search/similar/[id]/route.ts:14-21`, `apps/web/src/app/api/search/similar/[id]/route.ts:132-144`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-177`).
- The storage contract cannot retain multiple model versions: `imageEmbeddings.imageId` is the Drizzle primary key (`apps/web/src/db/schema.ts:284-290`) and migration 0012 creates `PRIMARY KEY (image_id)` (`apps/web/drizzle/0012_image_embeddings.sql:5-10`). Migration 0022 adds only a `(model_version, updated_at)` scan index, not a composite primary/unique key (`apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`).
- Writers overwrite the single row: the sidecar docs say “PK is image_id, so the upsert replaces any existing row in place” and “overwrites the stale vector + version” (`apps/web/scripts/backfill-clip-embeddings.ts:25-42`); its write path uses `onDuplicateKeyUpdate` (`apps/web/scripts/backfill-clip-embeddings.ts:205-223`). The upload queue also `insert(...).onDuplicateKeyUpdate` on the same row (`apps/web/src/lib/image-queue.ts:379-390`), and the server action mirrors that upsert pattern (`apps/web/src/app/actions/embeddings.ts:166-177`).
- The carry-forward ledger already records the schema fix exit criterion: store one row per `(image_id, model_version)` with Drizzle/reconcile/query/backfill updates and regression coverage (`.context/plans/cycle-91-2026-07-01-deferred.md:26-31`). The aggregate repeats the same failure scenario (`.context/reviews/_aggregate.md:51-61`).

**Why this matters**

The docs are honest about filtering, but the operator runbook can still imply model-version coexistence because it emphasizes `model_version` gating without warning that backfills replace the prior version in place. Switching stub -> production, rolling back to stub, or introducing a future production model version can leave routes filtering for a version that no longer exists for affected images.

**Suggested remediation**

Until the schema migration lands, add an explicit warning to `apps/web/README.md` and the CLIP runbook in `CLAUDE.md`: `image_embeddings` currently stores one row per image, and model-version transitions overwrite the previous row. Keep the existing deferred schema exit criterion for the actual fix.

### C92-DOC-03 — Restore-maintenance operational gap remains confirmed in source and should stay visible in docs/ledgers

- Severity: High
- Confidence: High
- Status: Confirmed carry-forward operational/source-contract issue (`C91-03` / `C77-ARCH-01`).

**Evidence**

- `CLAUDE.md` documents the restore-maintenance marker and says uploads and queue workers stay blocked across process restarts (`CLAUDE.md:400-401`). It also documents single-process/process-local topology limits (`CLAUDE.md:234-237`).
- The durable marker implementation is process-local plus a file marker: `beginDurableRestoreMaintenance()` calls `beginRestoreMaintenance()` then writes a marker (`apps/web/src/lib/restore-maintenance-durable.ts:96-107`), while `getRestoreMaintenanceMessage()` only checks the in-process `active` state (`apps/web/src/lib/restore-maintenance.ts:21-31`).
- Restore starts durable maintenance only after acquiring DB restore, upload-contract, color-backfill, and semantic-backfill locks (`apps/web/src/app/[locale]/admin/db-actions.ts:390-452`).
- Foreground admin mutations such as `updateTopic` only check `getRestoreMaintenanceMessage()` at entry (`apps/web/src/app/actions/topics.ts:182-189`), then can proceed through later transaction writes such as topic deletion during rename (`apps/web/src/app/actions/topics.ts:331-340`) without a shared post-entry barrier.
- The deferred ledger records the exact broader gap and exit criterion: “Restore maintenance does not fence in-flight non-upload admin mutations” and requires a shared foreground admin mutation barrier across application-table writers (`.context/plans/cycle-91-2026-07-01-deferred.md:19-24`).

**Why this matters**

The documentation correctly avoids claiming a full cluster-safe restore lock, but the operational ledger must keep the broader write-barrier gap prominent: a non-upload admin action that passes the initial maintenance check can still write after restore maintenance begins. That is a source-contract risk, not just a missing test.

**Suggested remediation**

Keep the deferred item open until foreground admin mutators share a restore-maintenance barrier that is checked close to write time or held across the mutation. When implemented, update `CLAUDE.md` race-protection wording and the deferred ledger together.

## Likely issues / lower-confidence documentation risks

### C92-DOC-L01 — `settings-hash` test comment overstates what the source-contract test can catch

- Severity: Low
- Confidence: Medium
- Status: Likely source-contract wording issue, not a runtime defect.

**Evidence**

- The test comment says the pinned exact 9-key set catches “a forgotten new byte-impacting key” at `npm test` (`apps/web/src/__tests__/settings-hash.test.ts:19-25`).
- The implementation comment is more precise: the compile-time guard validates that listed keys are real setting keys but “canNOT catch a *forgotten new* byte-impacting setting”; that gap is closed by the author checklist (`apps/web/src/lib/settings-hash.ts:44-55`).
- `CLAUDE.md` says the same: when a new setting changes derivative bytes, the author must add it to `COLOR_IMPACTING_KEYS`; the type guard cannot catch a forgotten new byte-impacting key (`CLAUDE.md:306-308`).

**Why this matters**

The test does pin the current 9-key membership and catches accidental drift in that list. It cannot detect a future byte-impacting setting that is added elsewhere but omitted from both `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` and the test’s expected list. The comment may give future maintainers a false sense that the test is fully exhaustive.

**Suggested remediation**

Reword the test comment to say it catches unintended changes to the documented 9-key list, while the new-setting case remains an author checklist obligation unless a metadata-driven setting registry is added.

## Manual-validation risks

### MV-C92-DOC-01 — `site-config.json` runtime/build-time behavior remains ambiguous without compiled Docker validation

- Severity: Medium
- Confidence: Medium

**Evidence**

- Docs tell operators that `src/site-config.json` owns static links/analytics defaults and that DB-backed SEO/branding fields override runtime values (`README.md:50-52`, `apps/web/README.md:46-49`, `CLAUDE.md:659-673`).
- Deployment also bind-mounts `./src/site-config.json` read-only into the running container (`apps/web/docker-compose.yml:24-28`), and deploy docs list it as persistent bind-mounted config (`AGENTS.md:19`, `CLAUDE.md:477`).
- Some consumers statically import the JSON into client/server bundles: nav client imports it and uses `home_link` (`apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:71-74`); root layout imports it for Google Analytics (`apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147-155`); sitemap imports it for fallback `BASE_URL` (`apps/web/src/app/sitemap.ts:14-18`).
- The carry-forward ledger already records this ambiguity and the exit criterion: either implement a validated runtime loader or document/remove the runtime mount and state edits require rebuild/deploy (`.context/plans/cycle-91-2026-07-01-deferred.md:33-38`).

**Risk**

A host operator may edit the bind-mounted file and restart the container expecting all config to change, while client-bundled/static imports may remain build-time-baked. This lane did not build a production image and inspect the emitted bundles, so the exact split-brain surface remains a manual-validation risk.

### MV-C92-DOC-02 — Current production deployment state for `508d355` was not verified live in this lane

- Severity: Low
- Confidence: High

**Evidence**

- The last committed release evidence records deploy/smoke for `aacccbc...`, not current HEAD `508d355...` (`.context/plans/cycle-91-2026-07-01-plan.md:61-65`, `.context/plans/README.md:11-13`).
- Live browser/product copy verification was already a Cycle 91 manual risk (`.context/plans/cycle-91-2026-07-01-deferred.md:40-48`, `.context/reviews/_aggregate.md:63-70`).

**Risk**

Static source can prove ledger contents, but not the active production commit. Confirm with a deploy/smoke or with a safe read-only production version endpoint if/when one exists.

### MV-C92-DOC-03 — Full quality gates and browser/E2E evidence were not rerun for this report-only lane

- Severity: Low
- Confidence: High

**Evidence**

- Blocking quality gates are documented in `AGENTS.md:31-38` and `CLAUDE.md:601-630`.
- Cycle 91 gate evidence exists for lint, auth/origin/rate-limit linters, typecheck, build, and unit tests (`.context/plans/cycle-91-2026-07-01-plan.md:67-75`).
- Browser/E2E coverage remained a manual-validation risk in the deferred ledger (`.context/plans/cycle-91-2026-07-01-deferred.md:44`).

**Risk**

This review changed no product source, so rerunning the full gate suite was not necessary to validate this report. It also means this lane cannot close browser-flow or current-head gate-evidence risks.

### MV-C92-DOC-04 — Networked dependency/security audit and production proxy IP attribution remain external validations

- Severity: Low
- Confidence: Medium

**Evidence**

- Proxy trust behavior is documented as required for rate limiting and same-origin checks behind reverse proxies (`README.md:166-168`, `apps/web/README.md:53-56`, `apps/web/.env.local.example:57-70`).
- The shipped nginx overwrites forwarded headers (`apps/web/nginx/default.conf:67-71`, `apps/web/nginx/default.conf:141-145`).
- Cycle 91 deferred risks record dependency CVE status and rate-limit IP attribution as requiring networked/production validation (`.context/plans/cycle-91-2026-07-01-deferred.md:45-47`, `.context/reviews/_aggregate.md:65-68`).

**Risk**

Local source aligns with the intended proxy model, but this lane did not inspect the deployed edge, run a networked dependency audit, or verify the effective production `TRUST_PROXY` / hop chain.

## Confirmed aligned / no new mismatch found

- **Deploy helper and prune policy align with docs.** `npm run deploy` calls `./scripts/deploy-remote.sh` (`package.json:11-22`), the helper reads root `.env.deploy` or `$HOME/.gallerykit-secrets/gallery-deploy.env` and refuses unsafe permissions (`scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:55-80`), and host deploy prunes only after `up -d` plus health with `docker volume prune -f` and no `-a` (`apps/web/deploy.sh:55-77`, `apps/web/deploy.sh:79-104`). This matches `AGENTS.md:17-20`, `CLAUDE.md:469-477`, and `README.md:120-131` / `README.md:187-205`.
- **Build/runtime env documentation matches compose/Docker source.** Build args include `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` (`apps/web/docker-compose.yml:4-11`, `apps/web/Dockerfile:83-100`), while production runtime sets `UPLOAD_ORIGINAL_ROOT` and `CLIP_MODELS_ROOT` (`apps/web/Dockerfile:105-115`). These match the public env docs (`README.md:135-165`, `apps/web/.env.local.example:12-87`).
- **Node/Next/React/TypeScript versions are consistent.** `CLAUDE.md` lists Next 16.2 / React 19 / TypeScript 6 (`CLAUDE.md:11`), `.nvmrc` pins Node 24 (`.nvmrc:1`), `apps/web/package.json` requires Node >=24 and uses Next `^16.2.9`, React `^19.2.5`, TypeScript `^6` (`apps/web/package.json:5-7`, `apps/web/package.json:57-85`).
- **Migration policy is backed by tests and source.** The runbook requires monotonic new `when` values and reconcile updates (`AGENTS.md:24-27`, `CLAUDE.md:424-448`); tests guard journal monotonicity/tag coverage and reconcile table/column/index/FK mentions (`apps/web/src/__tests__/migration-journal.test.ts:75-136`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-119`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:1-219`); `migrate.js` creates/baselines expected hashes and throws on missing hashes (`apps/web/scripts/migrate.js:720-824`). No new journal/schema mismatch was found.
- **Privacy/admin-only field docs match tests.** Public select omits admin-only fields including color/profile/pipeline/internal processing data (`apps/web/src/lib/data.ts:375-404`), and the symmetric test pins `SENSITIVE_KEYS` against the admin-only delta (`apps/web/src/__tests__/privacy-fields.test.ts:7-45`, `apps/web/src/__tests__/privacy-fields.test.ts:72-93`). This matches `AGENTS.md:27` and the color/HDR table in `CLAUDE.md:163-179`.
- **Upload API/nginx body-cap docs match source.** Public docs say the PAT upload route is an API contract, not a bundled Lightroom plugin, and carries a 216 MiB nginx cap (`README.md:207-218`, `apps/web/README.md:90-99`); nginx has a dedicated `^~ /api/admin/lr/upload` location with `client_max_body_size 216M` ahead of the generic `/api/admin/` 2 MiB cap (`apps/web/nginx/default.conf:124-151`).
- **Deprecated payment/hosted-SaaS docs match product posture.** README says the app is not for payment/hosted SaaS workflows (`README.md:29-32`), and `CLAUDE.md` permanently defers/removes paid downloads/Stripe (`CLAUDE.md:582-584`). I found no current operator doc instructing reintroduction.

## Final missed-issue sweep

Performed after drafting the findings:

- Re-read the authoritative deploy/schema/test sections in `AGENTS.md` and `CLAUDE.md` against the concrete source files cited above.
- Swept for deploy/env mismatches across `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, and `apps/web/nginx/default.conf`.
- Swept semantic-search contracts across docs, schema, migrations, search routes, upload queue, server action, and sidecar backfill; the only confirmed mismatch/gap is the known one-row-per-image version-retention issue.
- Swept migration/schema policy across `_journal.json`, migration tests, reconcile coverage tests, and `migrate.js`; no new mismatch found beyond documented historical inversion handling.
- Swept source-contract ledgers for privacy fields and settings-hash behavior; privacy is aligned, while the settings-hash test comment likely overstates completeness.
- Checked current Cycle 92 report headings for overlap; this report independently re-validated the document/source-contract subset and did not edit any other lane report.

Stop condition: report-only lane complete. No production action, deploy, database mutation, Docker prune, or test-suite rerun was performed.
