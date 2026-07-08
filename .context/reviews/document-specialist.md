# Run-10 Cycle 34 Document-Specialist Review

Role: document-specialist lane
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Review HEAD: `e94455d3` (`origin/master` at review time)
Scope: review-only documentation-vs-code review. No source-code edits, commits, pushes, deploys, destructive commands, or live-host changes. This file is the only intended modification.

## Inventory

Authority docs read first:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.context/plans/README.md`
- `.context/plans/run10-cycle33/plan.md`
- `.context/plans/run10-cycle33/deferred.md`
- existing root `.context/reviews/*.md` lane artifacts and committed run-10 review artifacts

Source/config/test surfaces inventoried and cross-checked:

- package/runtime: root `package.json`, `apps/web/package.json`, `apps/web/.nvmrc`, `.github/workflows/quality.yml`
- deployment: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`
- env docs: `apps/web/.env.local.example`, README env sections, CLAUDE env table
- migrations: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, schema/reconcile references
- product-boundary source: smart collections routes/actions/nav, storage abstraction, Lightroom upload route, payment-removal surface, no edit/culling/scoring claims
- enforcement: lint scripts, privacy guard tests, touch-target audit, public-route rate-limit scanner, API auth scanner, action-origin scanner
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, CLAUDE i18n convention
- operational runbooks: host nginx apply procedure, Docker prune contract, no-in-container-npm rule, CLIP semantic-search seeding/preflight, backfill sidecar procedures

Read-only validation evidence gathered:

- `git log --oneline --decorate -8` shows current `origin/master` at `e94455d3`, with Cycle 34 review commits after `5124d17e fix(cycle33): ...`.
- migration inventory: 31 SQL files and 31 journal entries; no missing SQL/journal pairing found. The non-monotonic historical `when` pattern is documented and guarded by `migrate.js` postconditions.
- i18n inventory: `en.json` and `ko.json` key sets matched at 877 keys each.
- package/doc version alignment: docs claim Next 16/React 19/TypeScript 6/Node 24+, and source has `next ^16.2.10`, `react ^19.2.5`, `typescript ^6`, `engines.node >=24`, `.nvmrc` `24`.

Existing unrelated dirty files observed before writing this artifact:

- `.context/reviews/architect.md`
- `.context/reviews/critic.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`

## Confirmed Findings

### DOC-C34-01 - Cycle 33 release ledger still says active/pending after Cycle 33 shipped and Cycle 34 review started

Severity: Medium
Confidence: High
Status: confirmed documentation/provenance mismatch

Evidence:

- `.context/plans/README.md:34-37` still lists Run-10 Cycle 33 as the active current-cycle plan/deferred pair.
- `.context/plans/README.md:46-49` lists recently completed cycles through Cycle 32, but not Cycle 33.
- `.context/plans/run10-cycle33/plan.md:3` says `Status: IMPLEMENTED - full gates passed; signed push and deploy pending`.
- `.context/plans/run10-cycle33/plan.md:126-128` marks required full gates complete while leaving signed commit/push and per-cycle deploy/live smoke unchecked.
- Command evidence from `git log --oneline --decorate -8`: `5124d17e fix(cycle33): ...` is already followed on `origin/master` by Cycle 34 review commits `53476e5d`, `bb61b083`, `68abb0ac`, and `e94455d3`.

Concrete failure scenario:

An agent following the plan index treats Cycle 33 as still active and reopens already-shipped work, or assumes Cycle 34 reviews should aggregate against a stale Cycle 33 ledger. The deploy evidence gap is also ambiguous: the plan says deploy pending, while later committed Cycle 34 review state implies the implementation cycle had already advanced.

Fix:

Update `.context/plans/README.md` to move Cycle 33 from "Active Current-Cycle Plans" to "Recently Completed Current-Cycle Plans" with the signed commit hash and explicit deploy/live-smoke state. Update `.context/plans/run10-cycle33/plan.md` to record terminal commit/push evidence and either record deploy/live-smoke evidence or leave a clearly superseded deploy gap. Add or point to the active Run-10 Cycle 34 plan/review aggregate so current-cycle routing does not fall back to Cycle 33.

### DOC-C34-02 - Root review handoff mixes current Cycle 34 lanes with stale Cycle 24 and Cycle 33 artifacts

Severity: Medium
Confidence: High
Status: confirmed documentation/provenance mismatch

Evidence:

- `.context/reviews/_aggregate.md:1-17` is still `Run-10 Cycle 33/100 Aggregate Review` and lists Cycle 33 lanes.
- `.context/reviews/_aggregate.md:21-37` still contains Cycle 33 merged findings and dispositions.
- `.context/reviews/designer.md:1-6` is a Cycle 24 designer review at HEAD `4b43fad7`.
- `.context/reviews/debugger.md:1-7` is a Cycle 24 debugger review at HEAD `4b43fad7`.
- `.context/reviews/code-reviewer.md:1-6` is a Run-10 Cycle 34 code reviewer report.
- `.context/reviews/security-reviewer.md:1-6` is a Run-10 Cycle 34 security review.
- `.context/reviews/architect.md:1-6` is now a Run-10 Cycle 34 architect review, so the root directory has mixed-generation active-looking lane files rather than a single coherent current-cycle set.

Concrete failure scenario:

A follow-on aggregator or reviewer scans `.context/reviews/*.md` and imports stale Cycle 24 designer/debugger findings or the Cycle 33 aggregate as if they are Cycle 34 evidence. That can duplicate already-superseded risks, miss current Cycle 34 lanes, or produce a false "complete aggregate" from mismatched review heads.

Fix:

Keep current-cycle lane artifacts in a cycle-qualified directory such as `.context/reviews/run10-cycle34/`, or update the root aggregate only after all Cycle 34 lanes finish. Add a small aggregation preflight that rejects mixed `Run-10 Cycle N` headers or mismatched review HEADs in the active input set. Archive or explicitly label stale root lane files so they are historical, not active inputs.

## Likely Findings

No additional likely docs/code mismatch found in this pass.

Areas checked without mismatch:

- Deploy helper docs match `scripts/deploy-remote.sh` env-file precedence and derived SSH command behavior.
- Docker prune docs match `apps/web/deploy.sh`: prune runs after `up -d`, uses bind mounts for data, and does not pass `-a` to `docker volume prune`.
- Migration docs match the current journal/reconcile/postcondition contract, including the strictly-greater `when` rule for new entries.
- Env tables match current upload limits, semantic-search knobs, restore-maintenance path, and proxy/CDN caveats.
- Product-boundary docs match source for local-only storage, Lightroom-compatible API without bundled plugin, no Stripe/payment surface, no edit/culling/scoring feature surface, and smart-collection public read without admin authoring UI.
- Quality-gate docs match package scripts and CI workflow names.
- i18n plural/asymmetry documentation matches the actual locale key parity.

## Manual-Validation Risks

### MV-C34-01 - Host nginx limiter state cannot be proven from repo files

Severity: Medium
Confidence: High that manual validation is required; not a confirmed code/docs mismatch

Evidence:

- `CLAUDE.md:248` says public SSR page limiting is enforced at the nginx edge and that per-iteration deploys rebuild the container only, not host nginx.
- `CLAUDE.md:514-526` says `apps/web/nginx/default.conf` is only a committed template and requires manual operator apply plus `nginx -t`/reload and live 429 validation.
- `apps/web/nginx/default.conf:1-29` defines the `public` and `nextimage` rate-limit zones and documents the real-IP caveat.
- `apps/web/nginx/default.conf:274-295` applies `limit_req zone=public burst=40 nodelay` only to `location /` and repeats that operator reload is required.

Concrete failure scenario:

The repo correctly documents and ships the limiter template, but the live host can still be running an older nginx config. A reviewer who closes edge-rate-limit findings based on commit state alone could overstate production protection.

Fix:

For the current cycle ledger, record live-host nginx apply evidence separately: config sync target, `nginx -t`, reload command, and burst tests proving overflow 429s while normal page loads do not. Keep this as a manual operational gate, not a source-code gate.

### MV-C34-02 - Production CLIP semantic-search readiness depends on seeded host weights and env/DB state

Severity: Medium
Confidence: High that manual validation is required; not a confirmed code/docs mismatch

Evidence:

- `CLAUDE.md:558-616` documents that CLIP weights are not baked into the image, production needs `CLIP_MODELS_ROOT`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, seeded weights, forced backfill, deploy/restart, and DB mode `production`.
- `CLAUDE.md:618-620` says the real CLIP preflight suites are skipped in CI because CI has no model weights.
- `apps/web/package.json:23` defines `test:clip:preflight` as an env-gated offline-load and semantic integration test requiring `CLIP_MODELS_ROOT`.

Concrete failure scenario:

Docs and code can both be correct while production semantic search still returns 503 or ranks with no real embeddings because the host lacks seeded weights, the env flag is absent in the running container, or the DB row was not flipped after backfill.

Fix:

Before marking semantic search production-ready, record host-side evidence: seeded model directory path, successful forced backfill completion, `CLIP_MODELS_ROOT=<abs> npm run test:clip:preflight`, deployed container env containing `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, DB row state, and a live semantic-search smoke result.

## Final Sweep

Common docs/code mismatch classes checked:

- package versions and Node policy: aligned
- deploy env precedence and SSH derivation: aligned
- Docker prune persistence safety: aligned
- migration SQL/journal/reconcile contract: aligned
- admin-only privacy field checklist: aligned by docs/tests; no new schema column found
- upload/proxy/body-size limits: aligned in env docs, CLAUDE, nginx, and app constants
- public/admin lint gate names and coverage: aligned
- i18n key parity and Korean plural convention: aligned
- product feature boundaries: aligned
- current review/plan provenance: two confirmed mismatches above

No tests, deploys, commits, pushes, or live-host validations were run for this review-only lane.
