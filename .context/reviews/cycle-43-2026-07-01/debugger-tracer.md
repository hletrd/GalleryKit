# Cycle 43 Debugger + Tracer Review

Reviewed HEAD `82a21b82` for latent runtime bugs, null/edge-state failures, async hazards, state consistency, and end-to-end flow failures across auth, uploads, processing, sharing, search, admin mutations, routing, and deploy.

Baseline treated as already known and not re-raised: Cycle 42 deferred `PA-42-02`, plus carried-forward `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`. I also did not duplicate the separate Cycle 43 code-reviewer/critic scanner finding.

## Confirmed Issues

None found.

## Likely Issues

None found.

## Risks Requiring Manual Validation

None newly identified. The production CLIP web-process catch-up/backfill locking concern remains the already-deferred `PA-42-02`.

## Runtime Trace Notes

- Auth/session/admin API: `auth.ts`, `session.ts`, `api-auth.ts`, `admin-tokens.ts`, `proxy.ts`, and `request-origin.ts` keep the expected chain of cookie/session checks, same-origin checks for browser admin requests, PAT scope checks for Lightroom API calls, and fail-closed request-origin handling. The admin protected layout still performs the real `isAdmin()` gate, so middleware cookie presence is not the only boundary.
- Upload/processing/restore: `images.ts`, `image-queue.ts`, `process-image.ts`, `admin/db-actions.ts`, `db-restore.ts`, and `api/admin/lr/upload/route.ts` show the expected upload-processing contract lock, restore maintenance gate, image queue pause/drain/resume behavior, duplicate processing claims, permanent failure state, and cleanup paths.
- Sharing/public analytics: `sharing.ts`, public shared-photo/group pages, `public.ts`, and `data.ts` validate share-key formats, filter to processed images, rate-limit share-key lookups, skip selected-photo navigation for shared-group counters, and use tracked background DB writes for analytics inserts.
- Search/similar: semantic and similar-photo routes enforce same-origin, maintenance, rate-limit, mode, abort, and enrichment gates. The search client has request-id and abort-controller protection before committing stale async results.
- Admin mutations: settings, SEO, users, tokens, tags, topics, collections, embeddings, and DB actions consistently gate mutators on maintenance, same-origin provenance, admin auth, and bounded input validation. Topic route mutations retain advisory locks and transaction-coupled slug/alias/smart-collection remaps.
- Public data/routing: listing cursors, smart-collection load-more, tag filters, public select fields, map GPS exposure, feed/sitemap helpers, and OG paths have explicit bounds or privacy guards in the reviewed code.
- Deploy/runtime: deploy scripts, Dockerfile, compose config, entrypoint, and migration script retain the documented order of pull/build/up/health/prune, writable bind-mount checks, private-original migration checks, and migration journal/hash assertion posture.

## Validation Evidence

- Required context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/debugger.md`, `.context/reviews/prompts/tracer.md`, latest `.context/reviews/_aggregate.md`, Cycle 42 aggregate, Cycle 42 plan, and Cycle 42 deferred register.
- Peer Cycle 43 artifact checked: `.context/reviews/cycle-43-2026-07-01/code-reviewer-critic.md`.
- Guard scanners run:
  - `npm run lint:api-auth --workspace=apps/web` - passed.
  - `npm run lint:action-origin --workspace=apps/web` - passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.

Not run: full `lint`, `typecheck`, `build`, unit tests, or Playwright e2e. This was a read-only review lane except for writing this artifact.
