# Cycle 8 Document Specialist Review - 2026-06-29

Role: `document-specialist`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `1e182969`  
Constraint: report-only pass; no implementation files edited.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant documentation and contract surfaces inventoried:

- Canonical docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Context history/indexes: `.context/plans/README.md`, `.context/reviews/_aggregate.md`, current `.context/reviews/cycle-8-2026-06-29/*`, latest run aggregate `.context/reviews/run9-cycle8/_aggregate.md`, and file inventories across `.context/plans`, `.context/reviews`, `plan`, and `docs/superpowers` (2303 markdown files).
- Superpowers docs: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Package/script contracts: root `package.json`, `apps/web/package.json`, package lock presence, `.nvmrc`, lint/type/build/test scripts.
- Deploy/ops contracts: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/.env.local.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/migrate.js`.
- Schema/migration contracts: all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, migration reconciliation and journal hash postconditions in `migrate.js`.
- Policy comments and lint/test contract surfaces: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `touch-target-audit.test.ts`, privacy-field fixtures, CLIP model/download comments, Docker prune comments, and source comments carrying `SECURITY-CRITICAL`, `DO NOT`, `MUST`, `admin-only`, `privacy`, `contract`, or equivalent policy language.

Intentionally excluded from content review: generated `.next`, `node_modules`, binary/media fixtures, uploads/runtime data, local env values, and raw build/runtime artifacts. They were inventory boundaries, not authoritative docs.

## Findings

### DOC-C8-01 - Action-origin docs still say `public.ts` is excluded, but the scanner now audits it with a public-action sub-contract

Severity: Low  
Confidence: High  
Status: Confirmed  
Category: docs/comment/test-name mismatch on a security-gate contract

Evidence:

- `CLAUDE.md:590-602` documents `lint:action-origin` as excluding basenames `auth` and `public`, then repeats that `auth.ts` and `public.ts` are intentionally excluded by name.
- `apps/web/scripts/check-action-origin.ts:47-72` defines `EXCLUDED_ACTION_BASENAMES = new Set(['auth'])`, so `public` is not excluded from discovery.
- `apps/web/scripts/check-action-origin.ts:328-344` contains a special `actions/public.ts` branch: an exempt public mutation passes only when `publicActionCallsRateLimitBeforeMutation(body)` proves a pre-mutation public rate-limit call.
- `apps/web/src/__tests__/check-action-origin.test.ts:383-394` has a stale test title claiming it excludes `auth.* and public.*`, while the assertion expects `public.tsx` to be discovered.
- `apps/web/src/__tests__/check-action-origin.test.ts:476-501` locks the actual behavior: exempt public analytics mutations pass with pre-insert rate limiting and fail without it.
- `apps/web/src/app/actions/public.ts:311-316` still says `public.ts` is excluded from the action-origin gate by name, while `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` use exempt comments plus pre-insert rate-limit checks at `apps/web/src/app/actions/public.ts:352-414`.

Concrete failure scenario:

A maintainer follows `CLAUDE.md` or the `public.ts` header while adding a new public analytics/write action. They believe the file is outside `lint:action-origin`, add only an exemption comment, and then either waste time debugging an unexpected gate failure or document an obsolete bypass model in future reviews. The current scanner still catches un-rate-limited public mutations, so this is not a present auth bypass; the risk is that the security-gate contract is misleading at exactly the place contributors look before changing public actions.

Concrete fix:

Update `CLAUDE.md:590-602` and `apps/web/src/app/actions/public.ts:311-316` to say only `auth` is excluded by basename. Document the real rule: `public.ts` is scanned, and an `@action-origin-exempt` public mutation is accepted only when it is read-only or satisfies the scanner's rate-limit-before-mutation sub-contract. Rename the test at `apps/web/src/__tests__/check-action-origin.test.ts:383` to match its assertions, for example `excludes auth.* while keeping public.* discoverable`.

## Verified Non-Findings

- Quality-gate docs in `AGENTS.md:31-37` match root/app package scripts in `package.json:11-23` and `apps/web/package.json:8-27`.
- Deploy docs and comments around bind mounts and pruning match the current compose/deploy implementation: persistent mounts in `apps/web/docker-compose.yml:17-27`, prune-after-`up -d` safety comments and commands in `apps/web/deploy.sh:30-62`.
- Migration journal and runbook claims match current implementation: `_journal.json` has SQL files for every entry, `migrate.js` hashes every journal entry, baselines by hash, reconciles legacy schema, and post-conditions missing hashes.
- CLIP semantic-search docs are current enough for live operation: the superpowers spec marks production activation, and code uses `jina-clip-v2-d512-q8`, offline `CLIP_MODELS_ROOT`, model-version filtering, and production gating.
- The latest schema/privacy checklist includes `processing_settings_json`: schema, migration, `data.ts` omit/type guard, and `privacy-fields.test.ts` are aligned.
- Prior Cycle 7 doc defects checked as closed or not re-filed: quick starts now say to create a category before upload, Lightroom token docs/nav are no longer the same stale Settings-only shape, and the semantic route is no longer stub-only in current operational docs.

## Validation Evidence

Read-only validation was by direct file inventory and line-cited source/doc comparison. I did not run full lint/type/test/build gates in this lane; other current Cycle 8 reports in this directory record those gates separately. No implementation files were changed.

## Final Missed-Issue / Skipped-File Sweep

Final sweep rechecked canonical docs, README files, `.context` indexes/aggregates, `docs/superpowers`, package scripts, migrations/journal, deploy scripts/config, env examples, security lint scanners, privacy fixtures, and policy comments for stale high-entropy claims. No additional non-duplicate false-doc finding survived the evidence threshold. The main residual risk is sheer historical volume in `.context`/`plan`: old plan/review bodies are intentionally preserved as history, so I treated active indexes, aggregates, and current code/doc contracts as authoritative rather than re-adjudicating every obsolete historical recommendation.
