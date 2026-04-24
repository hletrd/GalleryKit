# Performance Reviewer Deep Review — Cycle 2 Recovery (2026-04-24)

## Inventory and method

Agent-tool fan-out was attempted in one batch and retried once, but this session was already at the platform child-agent limit (`agent thread limit reached (max 6)`). Per Prompt 1 recovery rules, this compatibility lane completed the review directly and wrote this per-agent file rather than discarding partial review work. Earlier partial files for `document-specialist`, `perf-reviewer`, `product-marketer-reviewer`, and `tracer` were preserved under `.context/reviews/recovery-cycle2-partials/` before replacement.

Review-relevant inventory was built from `git ls-files` and focused on tracked source, tests, scripts, docs, deploy config, i18n messages, and active plan/context artifacts. Dependency/build/runtime artifacts (`node_modules`, `.next`, binary screenshots/fixtures, `test-results`, tsbuildinfo) were excluded. Key surfaces inspected for this lane included:

- Server actions and auth: `apps/web/src/app/actions/{auth,images,settings,sharing,topics,tags,admin-users,seo,public}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{action-guards,rate-limit,auth-rate-limit,restore-maintenance,revalidation}.ts`.
- Data/schema/cache: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, public page routes under `apps/web/src/app/[locale]/(public)/**`.
- Upload/processing/config: `apps/web/src/lib/{image-queue,process-image,upload-limits,upload-paths,gallery-config,gallery-config-shared}.ts`, settings UI/messages.
- Tests/gates: Vitest tests under `apps/web/src/__tests__/`, Playwright tests under `apps/web/e2e/`, custom lint scripts, package scripts.
- Docs/deploy: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `.env.local.example`, Docker/nginx/deploy files.

Final sweep: re-ran targeted `rg` sweeps for `share_key`, `sharedGroupImages`, `revalidateLocalizedPaths`, `checkRateLimit`, `incrementRateLimit`, `DB_SSL`, `--ssl-mode`, `image_sizes`, and setup/init documentation, then checked each finding against current source before recording it.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| AGG2C2-04 | MEDIUM | Medium-High | Confirmed | `image_sizes` can change while unprocessed jobs are in flight |

## Detailed findings

### AGG2C2-04 — `image_sizes` can change while unprocessed jobs are in flight

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** Medium-High
- **Files/regions:** `apps/web/src/app/actions/settings.ts:72-103`, `apps/web/src/app/actions/images.ts:224-305`, `apps/web/src/lib/image-queue.ts:240-263`, `apps/web/src/lib/process-image.ts:390-444`, public image URL consumers in `apps/web/src/lib/image-url.ts:24-48` and public routes.
- **Why this is a problem:** Settings blocks output-size changes only when a processed image exists. A new gallery can upload images (`processed=false`), start queue jobs with old sizes, then change `image_sizes` before any row becomes processed. The UI/public pages then request derivative filenames for the new size set while queued jobs may have produced only the old size set.
- **Failure scenario:** Admin uploads photos, immediately changes output sizes while processing is still running, then public thumbnails/metadata URLs are generated for sizes that do not exist on disk, causing broken images/OG previews after rows flip to processed.
- **Suggested fix:** Lock `image_sizes` once any image row exists, not only once a processed row exists, unless a full queue quiesce/regeneration workflow is introduced. Update admin copy/tests to reflect “uploaded” rather than “processed.”

## Final missed-issue sweep

Rechecked the inventory and targeted sweeps listed above after drafting findings. No relevant tracked source/config/doc/test file in this lane was intentionally skipped beyond generated/dependency/binary artifacts.
