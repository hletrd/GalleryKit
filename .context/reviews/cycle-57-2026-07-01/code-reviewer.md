# Cycle 57 Code and Correctness Review

Current HEAD reviewed: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`.

## Inventory Examined

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-55-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-56-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-56-2026-07-01/code-reviewer.md`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/settings-submit-payload.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- `apps/web/src/__tests__/cycle-56-source-contracts.test.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/__tests__/search-route-privacy.test.ts`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/meta/_journal.json`

## Findings

No new confirmed findings.

## Evidence

- Worktree/diff start state was clean (`git status --short` and `git diff --stat` returned no output before this artifact was written).
- Cycle 56 carry-forward review items were checked against current HEAD and not re-raised: no new evidence changed severity or scheduling for `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.
- Deploy permission fallback review:
  - `apps/web/deploy.sh:28-43` and `scripts/deploy-remote.sh:65-80` now read GNU `stat -c '%a'` first, fall back only on empty output, validate octal numeric output before arithmetic expansion, and reject group/world-readable env files before Docker/source consumption.
  - `apps/web/src/__tests__/deploy-script-contract.test.ts:158-220` executes the empty-GNU-output fallback path for both deploy scripts.
  - Local shell syntax check passed: `bash -n apps/web/deploy.sh scripts/deploy-remote.sh`.
- Settings/upload-contract review:
  - `apps/web/src/app/actions/settings.ts:73-155` normalizes and compares `image_sizes` / `strip_gps_on_upload` against persisted values before active-upload checks, lock acquisition, existing-image guards, and persistence.
  - Browser upload and LR upload paths hold or preclaim the upload-processing contract consistently enough for settings changes to see in-flight work (`apps/web/src/app/actions/images.ts:191-262`, `apps/web/src/app/api/admin/lr/upload/route.ts:130-286`).
- Public/admin photo data-flow review:
  - Metadata and OG keep using public image data (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:55-60`, `apps/web/src/app/api/og/photo/[id]/route.tsx:59-63`).
  - The viewer fetches admin fields only after `isAdmin()` resolves true (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143-150`), and public/admin select shapes remain separated with privacy guards (`apps/web/src/lib/data.ts:251-488`, `apps/web/src/lib/data.ts:1044-1205`).
- Public search/map privacy review:
  - Semantic and similar search enrich results through the shared guarded select (`apps/web/src/lib/search-enrichment-fields.ts:29-47`) and strip scores before response (`apps/web/src/app/api/search/semantic/route.ts:363-368`, `apps/web/src/app/api/search/similar/[id]/route.ts:267-272`).
  - Public GPS exposure remains confined to `getMapImages()` behind `topics.map_visible` and runtime assertion (`apps/web/src/lib/data.ts:1697-1721`), with map page props omitting extra admin fields (`apps/web/src/app/[locale]/(public)/map/page.tsx:48-60`).

Focused validation:

```text
npm test --workspace=apps/web -- deploy-script-contract.test.ts settings-semantic-mode-action.test.ts settings-submit-payload.test.ts cycle-56-source-contracts.test.ts settings-image-sizes-lock.test.ts
Test Files  5 passed (5)
Tests       29 passed (29)

npm run typecheck --workspace=apps/web
typecheck:app, check-js-scripts, and typecheck:scripts passed
```

## Missed-Issues Sweep

Final sweep covered recent diffs from `4dbbbf9b..HEAD`, Cycle 55/56 aggregate findings, public API route inventory, server actions inventory, privacy-sensitive field references, schema/journal tail, and deploy shell edge cases. No additional source-level correctness, race, maintainability, or photographer-facing data-flow issue was confirmed. Full e2e was not run because the inspected changes are deploy-script, server-action/data-flow, and source-contract focused rather than browser-flow behavior changes.
