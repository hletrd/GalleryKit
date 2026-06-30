# Cycle 30 Document Specialist Review

Role: document-specialist  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `666b74f8`  
Date: 2026-06-30  
Scope: Prompt 1 review only. No product fixes implemented.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Then checked current source/docs contracts across:

- Root/app docs: `README.md`, `apps/web/README.md`, `AGENTS.md`, `CLAUDE.md`.
- Package/CI/deploy surfaces: root/app `package.json`, `.github/workflows/quality.yml`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, Docker/Compose/nginx docs.
- Schema/migration runbook: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration tests.
- Operational docs: semantic CLIP activation, deploy pruning, restore maintenance, health/live, upload limits, trusted proxy, site config, auto alt-text.
- Test-contract docs: lint gates, touch targets, Playwright, public GET route scanning, migration monotonicity.

Generated screenshots, archived historical review prose, and old migration comments were not treated as current operator authority unless current docs pointed to them.

## Confirmed Issues

### C30-DOC-01 - `AGENTS.md` contradicts the current public-route rate-limit gate for GET handlers

Severity: Medium  
Confidence: High  
Status: Confirmed docs-vs-code mismatch

Files/regions:

- `AGENTS.md:31-38`
- `CLAUDE.md:619-623`
- `apps/web/scripts/check-public-route-rate-limit.ts:1-12`, `:57-72`, `:279-283`, `:340-390`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:93-144`

Problem:

`AGENTS.md` says `lint:public-route-rate-limit` scans public mutating handlers and that "GET handlers are not scanned." Current code and `CLAUDE.md` say the opposite for expensive public GET handlers: the scanner detects GET bodies with DB/image/filesystem/embedding markers and requires an approved limiter or a reasoned exemption. The current gate output also proves this path is active for OG and similar-image GET routes.

Failure scenario:

A contributor relies on the short-form `AGENTS.md` quality-gate summary, adds a DB-backed public GET route, and assumes the rate-limit gate will ignore GET. They may add no limiter or exemption, then get surprised by CI failures or, worse, try to bypass the gate because the canonical short-form docs describe the old rule.

Suggested fix:

Update `AGENTS.md:34` to match `CLAUDE.md` and the scanner: public mutating handlers and expensive public GET handlers must call an approved pre-increment/check-and-increment helper or carry `@public-no-rate-limit-required: <reason>`. Mention cheap operational GET handlers can pass without a limiter.

## Likely Issues

None promoted. Historical migration comments still contain superseded product wording such as Lightroom/Firenze-era planning language, but `CLAUDE.md:448` now explicitly marks those as historical errata and points maintainers to current docs/source for live behavior.

## Risks Needing Manual Validation

- Live production state was not validated: semantic-search DB mode, CLIP model volume, deployed nginx, and remote deploy behavior were not checked.
- Full docs rendered output was not inspected in a browser; this pass was source/markdown inspection.
- I did not run the full quality gate suite, only targeted gate/test checks supplied in the test-engineer artifact.

## Confirmed Matches / Non-Findings

- Root/app README and `CLAUDE.md` align with package versions visible in `apps/web/package.json`: Next 16.2, React 19, TypeScript 6, Sharp 0.34, Drizzle 0.45, Node 24 via `.nvmrc`.
- Auto alt-text docs now align with source: default-off local EXIF-derived hints, no hosted captioning, no automatic rewrite of existing rows, manual `backfill-alt-text.ts`.
- Public route freshness docs now name home/topic/photo/share/smart-collection/timeline/year/map dynamic surfaces and match the `revalidate = 0` route exports.
- Touch-target docs now mention both recursive scan roots and app-level extra files, matching `touch-target-audit.test.ts`.
- Migration runbook matches current migration tests: historical non-monotonic journal entries are documented, and new entries must exceed the global max `when`.
- Deploy docs match scripts on config-driven `.env.deploy`, no hardcoded host, post-up Docker pruning, no `volume prune -a` in the automatic deploy path, `/api/live` liveness, and bind-mounted mutable data.
- Semantic/similar docs match route posture: same-origin checks, process-local per-IP limiter, production CLIP opt-in, offline model weights, and bounded scan limits.
- Paid-download/Stripe removal docs match source: no current payment surface; remaining references are historical migrations/tests or prose explaining removal.

## Final Sweep / Skipped Areas

Final sweep terms and surfaces: deploy, `.env.deploy`, Docker prune, health/live, upload body caps, TRUST_PROXY, semantic/CLIP, auto alt-text, Lightroom/plugin wording, Stripe/payment, public route freshness, service-worker offline scope, touch-target audit, lint gates, migrations/journal, privacy fields, map/timeline/smart-collection docs.

Skipped: live deployment verification, external docs lookup, rendered README preview, and exhaustive archived review history. No fixes were implemented; this artifact is the only document-specialist output for Prompt 1.
