# Cycle 49 Code/Security/Performance Review

Date: 2026-07-01
Head: dc4f4acf
Perspective: code-reviewer + security-reviewer + perf-reviewer
Scope: review-only; no application source files edited.

## Inventory Examined

### Required Context

- `AGENTS.md` - git/deploy rules, schema migration rules, auth/rate-limit lint gates, privacy-field invariants, review artifact expectations.
- `CLAUDE.md` - architecture, security model, same-origin/admin invariants, public route rate-limit contract, image processing/backfill reliability rules, deferred issue register.
- `.context/plans/README.md` - active/recent plan routing for cycle 48 and current review-plan-fix context.
- `.context/reviews/_aggregate.md` and `.context/reviews/cycle-48-2026-07-01/_aggregate.md` - latest aggregate, closed cycle-48 item, and carried-forward deferred items.

### Source And Test Files

- `apps/web/src/app/actions/images.ts:70` - image cleanup failure collection and retry path.
- `apps/web/src/app/actions/images.ts:128` - upload action origin/admin checks, quota claim, disk/topic rollback, enqueue flow.
- `apps/web/src/app/actions/images.ts:648` - single-image delete auth, DB transaction, strict cleanup reporting.
- `apps/web/src/app/actions/images.ts:746` - bulk delete bounds, auth, transaction, bounded cleanup concurrency.
- `apps/web/src/app/actions/images.ts:984` - bulk metadata update validation, topic checks, transaction path.
- `apps/web/src/app/actions/images.ts:1207` - failed-image retry processing snapshot, enqueue rejection recovery.
- `apps/web/src/app/actions/public.ts:121` - public load-more rate limit before data access.
- `apps/web/src/app/actions/public.ts:170` - public search rate limit before query work.
- `apps/web/src/app/actions/public.ts:236` - topic-filtered public search and rate-limit path.
- `apps/web/src/app/actions/public.ts:417` - photo view analytics rate-limit before DB read/write.
- `apps/web/src/app/actions/public.ts:445` - navigation view analytics rate-limit before DB read/write.
- `apps/web/src/app/actions/public.ts:477` - topic view analytics rate-limit before DB read/write.
- `apps/web/src/app/api/search/semantic/route.ts:107` - same-origin and maintenance gates.
- `apps/web/src/app/api/search/semantic/route.ts:173` - public search rate limit before config, DB, and embedding work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:74` - same-origin and maintenance gates.
- `apps/web/src/app/api/search/similar/[id]/route.ts:98` - similar-search rate limit before image/config/vector work.
- `apps/web/src/app/api/og/route.tsx:80` - OG route pre-increment before DB/config work.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:62` - photo OG pre-increment before DB/config work.
- `apps/web/src/app/api/health/route.ts:1` and `apps/web/src/app/api/live/route.ts:1` - operational GET exemptions and cheap health/liveness behavior.
- `apps/web/public/sw.template.js:1` - service-worker admin bypass, runtime cache policy, stale image metadata, and metadata mutation queue.
- `apps/web/public/sw.template.js:244` - image derivative stale-while-revalidate path with bounded HEAD revalidation and 404/410 eviction.
- `apps/web/public/sw.template.js:361` - revocable HTML bypass and offline fallback behavior.
- `apps/web/src/lib/admin-backfill-runner.ts:1` - admin backfill lock, candidate processing, live DB reserve, deleted-mid-reencode cleanup.
- `apps/web/scripts/backfill-color-pipeline.ts:1` - sidecar backfill candidate selection and deleted-mid-reencode cleanup.
- `apps/web/src/lib/image-queue.ts:1` - queue concurrency, per-image lock, conditional processed update, cleanup on deleted-row race.
- `apps/web/src/lib/data.ts:54` - admin/public select-field separation and privacy-sensitive type guard.
- `apps/web/src/lib/search-enrichment-fields.ts:1` - public search enrichment select surface and privacy guard.
- `apps/web/src/__tests__/privacy-fields.test.ts:1` - privacy-sensitive key fixture and symmetric omission tests.
- `apps/web/scripts/check-action-origin.ts:1` - server-action origin scanner, import provenance, wrapper/export bypass checks.
- `apps/web/scripts/check-public-route-rate-limit.ts:1` - public route rate-limit scanner, helper provenance, expensive GET detection.
- `apps/web/src/__tests__/check-action-origin.test.ts:1` - scanner regression coverage for action-origin bypasses.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1` - scanner regression coverage for public-route rate-limit bypasses.
- `apps/web/src/components/image-manager.tsx:1` and `apps/web/src/components/home-client.tsx:1` - photographer-facing delete/upload/search/load-more UI reliability paths touched by recent work.

## Findings

No new findings.

I did not re-raise these carried-forward deferred items because this cycle did not uncover new severity or scheduling evidence for them: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Validation Evidence

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Source review found mutating server actions returning early on `requireSameOriginAdmin()` before protected work, admin API routes covered by the auth lint gate, and public expensive/mutating paths calling pre-increment rate-limit helpers before DB/vector/OG work.
- Source review found public image/search enrichment paths using the public select surfaces and privacy-sensitive compile/test guards rather than admin-only image fields.

## Findings Count

0
