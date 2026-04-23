# Verifier Review — leader fallback after verifier agent retry failure (current checkout only)

## Scope and inventory covered
Reviewed the current repository state with emphasis on whether claimed behavior is actually enforced by code/tests/docs:
- topic routing and validation: `apps/web/src/lib/validation.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/lib/constants.ts`
- photo viewer histogram correctness: `apps/web/src/components/histogram.tsx`, `apps/web/public/histogram-worker.js`, `apps/web/src/components/photo-viewer.tsx`
- restore/maintenance behavior: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, public read paths under `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`
- security/docs claims: `apps/web/.env.local.example`, `README.md`, `CLAUDE.md`

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 1

## Confirmed Issues

### VER3-01 — Topic validation claims route safety, but locale codes can still be accepted as topic slugs and aliases
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/validation.ts:1-16`, `apps/web/src/app/actions/topics.ts:51-65`, `apps/web/src/app/actions/topics.ts:328-336`, `apps/web/src/lib/constants.ts:1-6`
- **Why it is a problem:** Topic creation and alias creation both rely on `isReservedTopicRouteSegment()`, but that helper does not reserve the locale segments actually used by the router (`en`, `ko`). The code claims to prevent route conflicts, but it does not cover locale-prefixed paths.
- **Concrete failure scenario:** An admin creates a topic or alias named `en`. The write succeeds, but `/en` is already the locale root, so the topic cannot be reached at the route users expect.
- **Suggested fix:** Derive reserved route segments from `LOCALES` and reject locale codes for both slugs and aliases. Add regression coverage for both createTopic and createTopicAlias.

### VER3-02 — Histogram rendering is not actually bound to the active image under rapid navigation
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/histogram.tsx:21-58`, `apps/web/public/histogram-worker.js`
- **Why it is a problem:** `computeHistogramAsync()` resolves on the next worker `message` without correlating requests. Multiple in-flight requests attached to the shared worker can all consume the first response, so the UI can show the wrong histogram for the current image.
- **Concrete failure scenario:** The user flips quickly between photos in `PhotoViewer`; the first worker result arrives after the second request starts, and the second request resolves with the first image's histogram data.
- **Suggested fix:** Add per-request IDs and a pending-request map so each worker response is matched to the correct image request. Add regression coverage.

## Risks Requiring Manual Validation

### VER3-03 — Restore mode correctness is not proven for concurrent public readers
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** Risk requiring manual validation
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`, `apps/web/src/lib/restore-maintenance.ts:1-26`, public read paths under `apps/web/src/lib/data.ts` and `apps/web/src/app/actions/public.ts`
- **Why it is a problem:** The restore flag clearly blocks many mutations, but the public read paths do not obviously surface a maintenance response. The repo documents restore hardening, yet the current tests do not prove that public readers are handled consistently during a live restore.
- **Concrete failure scenario:** During a restore, public pages/search/load-more continue hitting partially restored tables and may return partial data or transient SQL errors.
- **Suggested fix:** Either enforce a public maintenance/read-only mode during restore or document and validate the intended degraded-read behavior in staging.

## Final sweep
- Rechecked the current checkout only.
- Excluded earlier cycle-2 metadata findings because those optimizations are already present in current source.
