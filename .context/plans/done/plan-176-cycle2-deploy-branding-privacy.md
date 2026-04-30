# Plan 176 — Cycle 2 Deploy, Branding, and Privacy Contract Fixes

**Created:** 2026-04-22
**Status:** DONE
**Purpose:** Implement the highest-signal cycle-2 fixes that are both user-requested and code-fixable this pass: self-resolving deploy config, operator-branding and metadata consistency, startup queue ownership, and a real privacy regression contract test.

## Scheduled Fixes

### C176-01: Let the repo derive the remote deploy command from gitignored env config
**Severity:** MEDIUM | **Confidence:** High
**Sources:** user-injected TODOs (`"find yourself and make sure to not ask again"`, `"please add config to gitignored env"`), `README.md:95-105`, `CLAUDE.md:229-238`, `scripts/deploy-remote.sh:1-21`, `.env.deploy.example:1-8`
**Files:** `scripts/deploy-remote.sh`, `.env.deploy.example`, `README.md`, `CLAUDE.md`

The repo already carries a gitignored root `.env.deploy`, but the helper still hard-requires a fully handwritten `DEPLOY_CMD`. That means automation still has to ask the operator for the exact command even though the file already stores the target host/user/key/path.

Implementation:
1. Teach `scripts/deploy-remote.sh` to derive the SSH deploy command from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH` when `DEPLOY_CMD` is omitted.
2. Support an optional `DEPLOY_REMOTE_SCRIPT` override while keeping `DEPLOY_CMD` as the explicit escape hatch.
3. Make `.env.deploy.example` a safe placeholder template instead of a repo-specific real target.
4. Update README + CLAUDE deploy docs so future runs can self-resolve from the gitignored env file without asking again.

### C176-02: Make public branding and metadata reflect the real rendered/filter state
**Severity:** MEDIUM | **Confidence:** High
**Sources:** local cycle-2 review, prior deferred branding finding (`.context/plans/175-deferred-cycle1-ultradeep-review.md`, row `C-OG`), `.context/reviews/code-reviewer.md` findings 1-2, `apps/web/src/app/api/og/route.tsx:9-83`, `apps/web/src/app/[locale]/(public)/page.tsx:17-53`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16-50`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:181-203`, `apps/web/src/app/global-error.tsx:43-60`, `apps/web/src/app/manifest.ts:1-28`
**Files:** `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/global-error.tsx`, `apps/web/src/app/manifest.ts`

Topic OG cards currently render the slug instead of the canonical topic label and still hardcode `GalleryKit`, homepage/topic metadata trust raw `tags` query params even when the rendered page filters them out, and the manifest route does not follow live SEO settings.

Implementation:
1. Pass canonical topic label and current site title into the OG image route instead of rendering only the slug.
2. Sanitize and length-bound the extra OG params so they stay safe and deterministic.
3. Reuse the same validated tag-slug set for metadata and rendered page content on home/topic pages.
4. Replace remaining hardcoded `GalleryKit` fallbacks in the touched code with the repo/site-config fallback title.
5. Make the manifest route dynamic so SEO updates actually propagate to manifest consumers.

### C176-03: Replace the privacy false-confidence test with a real public-field contract assertion
**Severity:** HIGH | **Confidence:** High
**Sources:** `.context/reviews/test-engineer.md` finding 1, `apps/web/src/lib/data.ts:149-188`, `apps/web/src/__tests__/privacy-fields.test.ts:1-54`
**Files:** `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`

The current privacy test passes without asserting the actual public/admin select contract, so it would not catch an accidental re-exposure of sensitive public fields.

Implementation:
1. Expose a narrow, server-only list of admin/public field keys from `data.ts` for regression testing.
2. Rework `privacy-fields.test.ts` to assert that the sensitive keys remain in the admin shape and out of the public shape.
3. Preserve the compile-time guard in `data.ts` so the test complements — rather than replaces — the type-level protection.

### C176-04: Make queue/bootstrap ownership explicit at startup and preserve claim-retry bookkeeping
**Severity:** HIGH | **Confidence:** High
**Sources:** architect subagent review content (`Finding 1`, `Finding 4`), `.context/reviews/critic.md` finding 1, `apps/web/src/instrumentation.ts:1-33`, `apps/web/src/lib/image-queue.ts:154-170,265-343`
**Files:** `apps/web/src/instrumentation.ts`, `apps/web/src/lib/image-queue.ts`

Pending image recovery and housekeeping should not depend on an upload-action import side effect, and claim-contention retries should not silently reset their own ceiling bookkeeping.

Implementation:
1. Bootstrap the image-processing queue explicitly during server startup.
2. Preserve claim-retry counts across delayed claim retries while still clearing the in-memory enqueued marker before the next retry is scheduled.
3. Keep the existing graceful-shutdown drain behavior intact.

### C176-05: Correct CLAUDE.md runtime guarantees that drifted from real code defaults
**Severity:** LOW | **Confidence:** High
**Sources:** verifier subagent review content, `CLAUDE.md:115-120,198-202`, `apps/web/src/lib/session.ts:16-79`, `apps/web/src/lib/upload-limits.ts:1-22`
**Files:** `CLAUDE.md`

The assistant-facing repo contract still says production sessions always use a DB-stored/generated secret and that uploads default to a 10GB batch cap, but the runtime now requires `SESSION_SECRET` in production and defaults total uploads to 2 GiB.

Implementation:
1. Update CLAUDE.md to describe the production `SESSION_SECRET` requirement plus the dev/test DB fallback accurately.
2. Fix the documented default batch-upload limit to match `UPLOAD_MAX_TOTAL_BYTES`.

### C176-06: Repair the repo-configured E2E gate so the declared command actually launches Playwright
**Severity:** MEDIUM | **Confidence:** High
**Sources:** cycle-2 quality gate run, `apps/web/package.json:13-20`
**Files:** `apps/web/package.json`

The required gate command `npm run test:e2e --workspace=apps/web` currently fails before running any tests because the workspace script cannot resolve the `playwright` binary.

Implementation:
1. Update the workspace script to invoke Playwright through a resolution path that works in this monorepo/workspace layout.
2. Re-run the E2E gate afterward to verify the script fix exposes the real test results instead of a shell lookup failure.

## Progress
- [x] C176-01: Deploy helper self-resolution from `.env.deploy`
- [x] C176-02: Metadata/branding consistency
- [x] C176-03: Real privacy contract regression test
- [x] C176-04: Explicit startup queue bootstrap + claim retry bookkeeping
- [x] C176-05: CLAUDE runtime guarantee corrections
- [x] C176-06: Working E2E gate command
