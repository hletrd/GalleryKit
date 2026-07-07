# Cycle 13 Document-Specialist Review - 2026-07-07

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `bafe639d`.
Mode: static documentation/source mismatch review. Only this assigned artifact was written; no source, plan, deploy, DB, service, or container state was changed.

## Inventory

Authoritative docs and current operational references examined:

- Root control docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Active/recent plan and review surfaces: `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/cycle-13-plan.md`, `.context/reviews/_aggregate.md`, top-level `.context/reviews/*.md`, `plan/plan-372-cycle13-fixes.md`, `plan/plan-373-cycle13-deferred.md`.
- Package/runtime surfaces: root `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/src/__tests__/nginx-config.test.ts`.
- Migration and generated/runtime behavior: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, migration SQL set, `apps/web/src/lib/rate-limit.ts`, CLIP semantic-search routes/config/scripts, health/live routes, SIGTERM/view-count shutdown wiring, site-config build guard, and service-worker generation notes.
- README/docs under `docs/superpowers/**` were checked for live-vs-historical status.

Skipped deliberately:

- Secret-bearing local env files (`.env.deploy`, `apps/web/.env.local`) were not opened; the reviewed surfaces are the checked-in examples and deploy scripts.
- Archived historical review/plan records were keyword-swept for current contradictions but not treated as active unless an active index or plan points at them.
- No live host, production DB rows, seeded CLIP weights, nginx host config, or deployed env values were inspected.

## Findings

### DOC-C13-01 - Cycle 13 plans point at a stale Cycle 12 aggregate

- Severity: Medium
- Confidence: High
- File/line region: `.context/plans/cycle-13-plan.md:1-4`; `.context/reviews/_aggregate.md:1-6`, `.context/reviews/_aggregate.md:36-56`; `plan/plan-372-cycle13-fixes.md:1-6`, `plan/plan-372-cycle13-fixes.md:27-73`; `plan/plan-373-cycle13-deferred.md:1-15`.
- Mismatch: `.context/plans/cycle-13-plan.md` says `.context/reviews/_aggregate.md` is the cycle 13 source at HEAD `80145992`, and the plan files use `AGG-C13-*` IDs. The actual `.context/reviews/_aggregate.md` is still titled "Cycle 12 Aggregate Review", says `Cycle: 12/100`, reviewed HEAD `173668e...`, and contains `AGG-C12-*` findings.
- Failure scenario: a future agent follows the active plan's source pointer, reads the stale aggregate, and schedules or defers Cycle 12 findings while Cycle 13 plans reference IDs that cannot be traced in the cited aggregate. This can silently drop Cycle 13 review evidence or resurrect already-handled Cycle 12 work.
- Suggested fix: either regenerate/update `.context/reviews/_aggregate.md` with the actual Cycle 13 aggregate and HEAD, or change every active Cycle 13 plan to point at the real Cycle 13 aggregate file. Add a simple freshness check: plan cycle/id must match aggregate cycle/id before implementation planning.

### DOC-C13-02 - The active plan index still says Cycle 10 is current

- Severity: Medium
- Confidence: High
- File/line region: `.context/plans/README.md:34-42`; current Cycle 13 evidence: `plan/plan-372-cycle13-fixes.md:1-6`, `plan/plan-373-cycle13-deferred.md:1-7`, `.context/reviews/code-reviewer.md:1`, `.context/reviews/perf-reviewer.md:1`, `.context/reviews/security-reviewer.md:1`, `.context/reviews/verifier.md:1`.
- Mismatch: `.context/plans/README.md` lists "Run-10 Cycle 10/100" as the active current-cycle plan/deferred pair. The current top-level plan files are Cycle 13, and several active top-level review files are also Cycle 13.
- Failure scenario: an agent using the documented plan index as the active control surface starts from Cycle 10, updates the wrong deferred ledger, or applies stale age-budget calculations while Cycle 13 is the actual working set.
- Suggested fix: update the index's "Active Current-Cycle Plans" section to the Cycle 13 plan/deferred pair, or make the section intentionally non-current and point to a machine-checkable "latest plan" pointer. Keep `.context/plans/README.md` synchronized whenever `plan/plan-NNN-cycleXX-*` is advanced.

### DOC-C13-03 - Active top-level review slots mix Cycle 11, 12, 13, 30, 33, and 35 artifacts

- Severity: Low-Medium
- Confidence: High
- File/line region: `.context/reviews/document-specialist.md:1` before this update was Cycle 11; `.context/reviews/architect-document-specialist.md:1` is Cycle 12; `.context/reviews/debugger.md:1`, `.context/reviews/test-engineer.md:1`, `.context/reviews/tracer.md:1`, `.context/reviews/designer.md:1` are Cycle 11; `.context/reviews/architect-debugger.md:1` is Cycle 33; `.context/reviews/critic-verifier-designer-document.md:1` is Cycle 35; current Cycle 13 examples are `.context/reviews/code-reviewer.md:1`, `.context/reviews/perf-reviewer.md:1`, `.context/reviews/security-reviewer.md:1`, `.context/reviews/verifier.md:1`.
- Mismatch: top-level `.context/reviews/*.md` reads like the active reviewer surface, but the files are not uniformly the latest cycle. Some are current Cycle 13, while others are historical from earlier cycles.
- Failure scenario: a planner or aggregator treats all top-level review files as the current cycle's reviewer set and mixes stale Cycle 11/12/30/33/35 findings into Cycle 13 triage. This can duplicate closed issues, hide missing current reviewer lanes, or make provenance claims false.
- Suggested fix: move historical top-level role outputs into cycle-scoped folders or update every top-level role file atomically per cycle. Add a current-cycle manifest listing expected role files and their cycle/head, then have aggregates/plans cite that manifest instead of globbing top-level review files.

### DOC-C13-04 - nginx multi-hop remediation guidance is split across incompatible contracts

- Severity: Medium
- Confidence: High
- File/line region: active deferrals `.context/plans/cycle-1-2026-07-06-deferred.md:74-81`, `plan/plan-373-cycle13-deferred.md:11-15`; current source/tests `apps/web/nginx/default.conf:20-28`, `apps/web/nginx/default.conf:59-71`, `apps/web/src/__tests__/nginx-config.test.ts:33-44`, `apps/web/src/lib/rate-limit.ts:175-197`; operator docs `README.md:172-174`, `apps/web/README.md:56`, `apps/web/.env.local.example:63-70`.
- Mismatch: active deferrals say the LB-fronted fix is to switch client-facing locations to `$proxy_add_x_forwarded_for` and set `TRUSTED_PROXY_HOPS` to the "real hop count." Current tests explicitly forbid `$proxy_add_x_forwarded_for` in the shipped template and require docs to say nginx overwrites XFF with `$remote_addr`. The current READMEs/env docs tell operators with another trusted edge to configure nginx `real_ip` before forwarding headers, preserving the `$remote_addr` normalization model. The nginx file itself mentions both the append-form remediation and separate `realip` requirements for limiter zones.
- Failure scenario: an operator follows the stale deferral literally, changes XFF to append, and guesses `TRUSTED_PROXY_HOPS=2` for a client -> LB -> nginx chain. With an app-visible chain like `client, lb`, `getClientIp()` computes no client slot and falls back to `X-Real-IP`/LB, collapsing users into one bucket. If inbound XFF is not scrubbed by the outer edge, append-form can also reintroduce spoofable client identities that the current `$remote_addr` tests intentionally prevent.
- Suggested fix: rewrite the active deferrals and nginx comments around one explicit supported contract. Option A: shipped/default contract is "nginx normalizes the client to `$remote_addr` via direct edge, PROXY protocol, or `real_ip`; app keeps `TRUSTED_PROXY_HOPS=1`; tests continue forbidding append." Option B: multi-hop XFF preservation becomes supported, but then update nginx config, `TRUSTED_PROXY_HOPS` examples, tests, and operator docs together with concrete example chains.

### DOC-C13-05 - Carry-forward keeps two runtime-site-config rows for one product decision

- Severity: Low
- Confidence: High
- File/line region: `.context/plans/deferred-carry-forward.md:24-29`, `.context/plans/deferred-carry-forward.md:60`, `.context/plans/deferred-carry-forward.md:76`; authoritative current docs/source: `CLAUDE.md:157`, `README.md:58`, `README.md:197`, `apps/web/README.md:50`, `apps/web/docker-compose.yml:28-32`.
- Mismatch: the carry-forward note says the build-time `site-config.json` contract is documented and the remaining item is only the product/operator decision of whether runtime-editable file config is desired. The open rows still include both `C80-06` and `C2-24b`, which describe the same runtime-editable site-config decision.
- Failure scenario: backlog age-budget checks count the same product decision twice, making future cycles spend review/planning capacity on duplicate rows and obscuring the single real decision: keep build-time JSON or build a runtime-editable config surface.
- Suggested fix: merge `C80-06` and `C2-24b` into one open carry-forward row with the current build-time contract cited. Remove the duplicate row or mark it as folded into the survivor.

## Verified Aligned Areas

- Package scripts align with the blocking gates listed in `AGENTS.md` and `CLAUDE.md`: lint, API-auth lint, action-origin lint, public-route rate-limit lint, typecheck, build, Vitest, and Playwright e2e/admin commands.
- Deploy docs align with `scripts/deploy-remote.sh`, `.env.deploy.example`, and `apps/web/deploy.sh`: env-file fallback, permission refusal, config-driven SSH, host-side `git pull --ff-only`, health gate on `/api/live`, and prune-after-health without `volume prune -a`.
- Migration docs align with `apps/web/scripts/migrate.js` and `_journal.json`: monotonic `when` authoring rule, hash postconditions, pending-vs-drift split, DML-baseline guard, and `reconcileLegacySchema` dual-update requirement.
- Root/app README and `CLAUDE.md` align with current CLIP behavior: fresh installs default disabled; production requires seeded weights, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, matching `model_version` rows, and operator preflight. `docs/superpowers/**` correctly labels the CLIP plan/spec as historical records, not live operator state.
- Product-boundary docs align with source/package truth: no Stripe/payment surface, no bundled Lightroom Classic plugin, local filesystem storage is the only supported product storage backend, and no editing/culling/scoring feature is advertised as shipped.
- Admin-token docs now align with source: `X-GalleryKit-Token`, `gk_` prefix, base64url random bytes, SHA-256 DB storage, token scopes, expiry, and last-used tracking.

## Final Sweep

Search/inspection terms included: deploy/prune/env, migration/journal/baseline/reconcile/DML, CLIP/semantic/production/model_version, `site-config`, nginx/XFF/realip/TRUSTED_PROXY_HOPS, upload/body limits, `/api/live` and `/api/health`, SIGTERM/view-count flush, Stripe/payment, Lightroom plugin, S3/MinIO/storage, smart collections, editing/culling/scoring, and quality-gate script names.

No source or test commands were run; this was a static documentation/source review. The main residual risk is live production state: this review did not verify host nginx config, deployed env, production DB rows, CLIP weights, or remote deploy status.
