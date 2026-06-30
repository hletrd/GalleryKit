# Cycle 20 — Implementation Plan

Source: `.context/reviews/_aggregate.md` and all cycle-20 per-agent reviews.  
Planning date: 2026-06-30 KST.  
Repo rules consulted before scheduling/defer decisions: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context/reviews/*`, and current `.context/plans/*`.

Every implementation commit must be GPG-signed (`git commit -S`), Conventional Commits + gitmoji, no `Co-Authored-By`, `git pull --rebase` before push, and all configured gates must pass before deploy.

## Implement This Cycle

### T1 — Backup/restore watchdog kill correctness

Finding: `AGG-C20-01`  
Severity/confidence: High / High  
Files: `apps/web/src/app/[locale]/admin/db-actions.ts`, focused test file under `apps/web/src/__tests__/`

- [x] Replace the `child.killed` grace-period check with an observed-exit/close settled flag.
- [x] Ensure timeout still rejects exactly once, sends `SIGTERM`, then sends `SIGKILL` if the child has not actually exited.
- [x] Add a regression for timeout behavior.

### T2 — Privacy analytics copy truthfulness

Findings: `AGG-C20-02`, `AGG-C20-33`  
Severity/confidence: High / High and Medium / High  
Files: `apps/web/messages/en.json`, `apps/web/messages/ko.json`; test if an existing privacy/message fixture covers this copy.

- [x] Make GA-disabled and GA-enabled privacy copy disclose first-party view analytics.
- [x] Remove the false persisted "client fingerprint" claim.
- [x] Keep wording clear that full IP addresses are not stored in analytics rows.

### T3 — Smart-collection load-more rate-limit accounting

Finding: `AGG-C20-04`  
Severity/confidence: Medium / High  
Files: `apps/web/src/app/actions/public.ts`, `apps/web/src/__tests__/load-more-rate-limit.test.ts` or adjacent public-action test.

- [x] Keep missing/private smart-collection responses charged after `getSmartCollectionBySlugCached()` runs.
- [x] Add regression coverage proving post-lookup missing/private branches do not call rollback.

### T4 — Docker build/runtime env unification

Finding: `AGG-C20-05`  
Severity/confidence: Medium / High  
Files: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, deploy/next-config tests/docs as needed.

- [x] Make deploy's Compose build read the same `.env.local` source used by the runtime container.
- [x] Wire `NEXT_UPLOAD_BODY_MAX_BYTES` through Compose/Docker build args if it remains a build-time value.
- [x] Add or update a contract test so documented build-time env keys cannot drift from the Docker build surface.

### T5 — CLIP and semantic route documentation contracts

Findings: `AGG-C20-08`, `AGG-C20-09`, `AGG-C20-10`, `AGG-C20-38`  
Severity/confidence: Medium / High, Low / High, Low-Medium / High, Low / Medium  
Files: `CLAUDE.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/rate-limit.ts`.

- [x] Document CLIP backfill as repeat-until-empty when corpus size exceeds `SEMANTIC_SCAN_LIMIT`.
- [x] Align `SEMANTIC_TOP_K_MAX` docs/examples with the code/test default of 50 unless implementation evidence says 24 is intentional.
- [x] Update semantic rollback comments to match current charged route policy.
- [x] Replace or align the script-local sidecar command comment with the authoritative runbook.

### T6 — Topic OG `tags` parser bound

Finding: `AGG-C20-14`  
Severity/confidence: Low-Medium / Medium  
Files: `apps/web/src/app/api/og/route.tsx`, OG tests.

- [x] Bound accepted `tags` input before splitting, or parse until 20 candidate tags without allocating the whole list.
- [x] Add regression coverage for large tag input.

### T7 — Similar-photo abort handling

Finding: `AGG-C20-12`  
Severity/confidence: Low-Medium / Medium-High  
Files: `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/__tests__/similar-route.test.ts`.

- [x] Mirror semantic route abort checks in the similar route around admitted expensive phases.
- [x] Add a test for an already-aborted request returning before semantic rate-limit charge where possible.

### T8 — Live keyword search failure investigation and fix

Finding: `AGG-C20-03`  
Severity/confidence: High / High user-visible, Medium root cause  
Files: likely `apps/web/src/components/search.tsx`, `apps/web/src/app/actions/public.ts`, search/data tests.

- [x] Isolate a server-action registration risk: the visitor search UI imported the public action through the broad `@/app/actions` barrel instead of the direct `'use server'` module.
- [x] Fix the action/UI failure path without masking errors by importing `searchImagesAction` directly from `@/app/actions/public`.
- [x] Add focused regression coverage for the direct public-action import contract.

### T9 — Dense prefetch and photo-page UX risk reduction

Findings: `AGG-C20-11`, `AGG-C20-31`, `AGG-C20-32`  
Severity/confidence: Medium / Medium, Medium / High, Medium / High  
Files: `apps/web/src/components/photo-card.tsx`, `apps/web/src/components/photo-viewer.tsx`, adjacent source/interaction tests.

- [x] Disable automatic prefetch on dense masonry/detail cards where no user intent exists.
- [x] Remove hidden adjacent-photo auto-prefetches if they can invoke render-time side effects.
- [x] Make key desktop photo context/download access visible by default or persistently surfaced.

### T10 — Mobile nav utility access

Finding: `AGG-C20-30`  
Severity/confidence: Medium / High  
Files: `apps/web/src/components/header.tsx`, nav tests if present.

- [x] Prevent clipped mobile collapsed topic links from taking priority over search/theme/language utilities.
- [x] Keep 44 px touch targets and focus visibility.

### T11 — Small correctness/security hardening

Findings: `AGG-C20-15`, `AGG-C20-16`, `AGG-C20-17`, `AGG-C20-37`  
Severity/confidence: Medium / Medium, Low / Medium, Low / Medium, Low-Medium / Medium  
Files: `apps/web/nginx/default.conf`, backup download route, image delete action, shared-photo page/tests.

- [x] Harden forwarded-IP defaults in nginx/config docs so inbound spoofed XFF is not trusted by default.
- [x] Use descriptor-backed backup download validation/streaming if the diff remains contained.
- [x] Return stale/not-found when single-image delete affects zero rows.
- [x] Decide and implement `/s/[key]` photo-view recording if product semantics support counting single-photo share views; otherwise document the exclusion in the same cycle.

### T12 — Gate and plan updates

- [x] Run every configured gate from cycle context.
- [x] Fix blocking errors and best-effort warnings found in focused tests.
- [x] Update this plan with completed/deferred status.
- [ ] Commit/push fine-grained signed commits.
- [ ] Deploy once with `npm run deploy` after green gates.

## Explicitly Deferred

All remaining aggregate findings are recorded in `cycle-20-deferred.md` with severity/confidence preserved, reason, and exit criterion.

## Progress

Status: Implementation and full configured gate sweep complete; signed commit/push and per-cycle deploy still pending.
