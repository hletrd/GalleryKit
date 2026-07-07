# Cycle 11 Document-Specialist Review - 2026-07-07

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `163b9dd0`.
Mode: static documentation/source mismatch review. Only this assigned artifact was written; no source, plan, deploy, DB, service, or container state was changed.

## Inventory

- Canonical docs: `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`.
- Runbooks and planning records: `docs/superpowers/**`, `.context/plans/**`, `.context/reviews/**`, and ignored `.omc/wiki/**` because cycle-10 review/deferred records reference it as still operationally visible local documentation.
- Executable/source truth: root and app `package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/deploy.sh`, Dockerfile/Compose/nginx config, `apps/web/scripts/migrate.js`, migration journal/SQL, semantic-search routes/config, SEO/site-config source, and security lint scripts.
- Final sweep terms: deploy/prune/env, migration/journal/baseline/reconcile/DML, CLIP/semantic/production/model_version, `site-config`, nginx/body limits, `TRUST_PROXY`, Stripe/payment, Lightroom plugin, S3/MinIO/storage, smart collections, editing/culling/scoring, quality-gate script names.

## Findings

### DOC-C11-01 - Ignored wiki still says new migrations do not execute on existing DBs

- Severity: Medium
- Confidence: High
- Validation label: confirmed-static
- File/line region: `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md:19-27`; authoritative source/docs: `apps/web/scripts/migrate.js:889-947`, `apps/web/scripts/migrate.js:949-974`, `CLAUDE.md:449-450`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:1-16`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:97-111`.
- Mismatch/failure scenario: the wiki says a new `apps/web/drizzle/NNNN_*.sql` migration is baselined without executing on already-provisioned DBs. Current `migrate.js` leaves above-cursor pending migrations unbaselined so Drizzle applies their SQL, and only true drift is reconciled/baselined. A maintainer following the wiki can put DML into `reconcileLegacySchema`, manually baseline a pending migration, or debug a deploy under the false assumption that committed SQL is dead, recreating the silent-SQL-loss class the current guard prevents.
- Concrete fix: either remove/export-retire this ignored wiki as non-authoritative, or rewrite Lesson 1 to match the current pending-vs-drift split: pending above-cursor entries run through Drizzle, true at/below-cursor drift is reconciled and guarded, mixed tails are left unbaselined, and DML must ride the Drizzle apply path unless deliberately mirrored and allowlisted.

### DOC-C11-02 - Ignored CLIP wiki overclaims production live state

- Severity: Low
- Confidence: High
- Validation label: confirmed-static
- File/line region: `.omc/wiki/clip-semantic-search-us-p51.md:15-17`, `.omc/wiki/gallerykit-architecture-overview.md:30-33`; authoritative source/docs: `apps/web/README.md:65-90`, `CLAUDE.md:160`, `apps/web/src/lib/gallery-config-shared.ts:119-120`, `apps/web/src/lib/gallery-config-shared.ts:176-228`, `apps/web/src/lib/gallery-config.ts:123-126`.
- Mismatch/failure scenario: the wiki labels CLIP semantic search as "LIVE in production." The canonical docs and resolver say production is operator-enabled, default-disabled for fresh installs, and healed to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is present with seeded weights and matching embeddings. A future operator/agent can skip the activation proof or misdiagnose expected 503s as regressions.
- Concrete fix: replace "LIVE in production" with "operator-enabled; verify deployed host state before claiming active." Link to `apps/web/README.md` "Going live" and `CLAUDE.md`'s `image_embeddings` runbook. If `.omc/wiki` is intentionally ignored, add a tracked note that ignored wiki pages are not current operator runbooks.

### DOC-C11-03 - Carry-forward still treats the site-config ambiguity as open after the doc contract shipped

- Severity: Low
- Confidence: Medium-High
- Validation label: confirmed-static for stale ledger wording; manual for product decision
- File/line region: `.context/plans/deferred-carry-forward.md:24-26`, `.context/plans/deferred-carry-forward.md:57-58`, `.context/plans/deferred-carry-forward.md:74`, `.context/plans/cycle-80-2026-07-01-deferred.md:8-13`; resolving/current evidence: `CLAUDE.md:148`, `README.md:56-58`, `apps/web/README.md:49-57`, `apps/web/docker-compose.yml:28-32`, `.context/plans/cycle-2-2026-07-07-plan.md:219-227`, `.context/reviews/cycle10-2026-07-07/document-specialist.md:72`.
- Mismatch/failure scenario: active carry-forward still re-justifies `C80-06` as a site-config runtime/build contract ambiguity, while current canonical docs and Compose comments explicitly state `site-config.json` is build-time inlined and runtime edits require rebuild/deploy. Future planning cycles can keep spending age-budget attention on a resolved documentation ambiguity instead of tracking the remaining, different product question: whether operators need runtime-editable config fields.
- Concrete fix: close or reword the `C80-06` carry-forward row as resolved-by-docs. If runtime editability remains desired, keep it as a separate product-decision row with current wording such as "decide whether to implement runtime-editable site config," not "runtime/build contract is ambiguous." Update `deferred-carry-forward.md` and the plan index so the active backlog matches the canonical contract.

## Verified Aligned Areas

- Current root/app READMEs and `CLAUDE.md` align with package scripts for lint, API-auth lint, action-origin lint, public-route rate-limit lint, typecheck, build, Vitest, and Playwright e2e.
- Deploy docs align with `scripts/deploy-remote.sh` and `apps/web/deploy.sh`: env-file fallback, permission refusal, config-driven SSH, health gate, and post-health Docker pruning without `volume prune -a`.
- Migration runbook and source align for monotonic `when`, hash postconditions, guarded DML baselining, pending-tail apply behavior, and `reconcileLegacySchema` authoring expectations.
- Active tracked semantic-search docs now correctly describe one active embedding row per `image_id`, model-version overwrite semantics, default-disabled production, offline weights, env opt-in, and preflight requirements.
- Product boundary docs remain aligned with source/package truth: no Stripe/payment surface, no bundled Lightroom Classic plugin, local filesystem storage only, and no editing/culling/scoring feature claim.

## Final Sweep

No source or test commands were run; this was a read-only static review. The two `.omc/wiki` mismatches are persistent from cycle 10 and still present locally; cycle-10 deferred records already note they are ignored/untracked. The new cycle-11 issue is the stale active carry-forward wording around the now-documented site-config contract. Residual risk: live deployed state was not inspected, including production DB rows, nginx host config, seeded CLIP model files, and runtime environment variables.
