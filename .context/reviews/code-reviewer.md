# Cycle 30 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `8db1df97a8ffa9b3357c4242b501bb19f9db7c30`
Date: 2026-06-30 KST
Scope: review only. No product code fixes were implemented.

## Inventory Summary

I built the inventory from current HEAD before reviewing implementation details.

Tracked file inventory:

| Area | Count / Coverage |
| --- | --- |
| Total tracked files | 2609 |
| App route/page/action/component source | `apps/web/src/app/**`, `apps/web/src/components/**` |
| Server actions | 13 files under `apps/web/src/app/actions/**` |
| API routes | 8 route files under `apps/web/src/app/api/**` |
| Library/runtime code | 100 files under `apps/web/src/lib/**` |
| DB/schema/migrations | `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js` |
| Tests | 281 unit test files under `apps/web/src/__tests__`; 8 Playwright e2e files |
| Project docs/history | `AGENTS.md`, `CLAUDE.md`, `.context/**` review and plan history |

Primary files examined for this lane:

- `AGENTS.md`
- `CLAUDE.md`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/c/[slug]/page.tsx`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- representative privacy, restore, semantic-search, upload, topic, migration, and touch-target tests

## Findings

### C30-CODE-01: Dormant local storage reads validate a path, then reopen it by path

Severity: Low
Confidence: Medium
Classification: Likely issue in dormant/future-facing code

Exact region:

- `apps/web/src/lib/storage/local.ts:115-122`
- Contrast live hardened serving path in `apps/web/src/lib/serve-upload.ts:166-184`

Evidence:

`LocalStorageBackend.createReadStream()` resolves the key, calls `fs.lstat(filePath)`, rejects symlinks/non-files, then returns `createReadStream(filePath)`. That creates a time-of-check/time-of-use gap because the path is checked once and then opened again by name. The live public serving path uses a stronger pattern: resolve containment, open the file handle, then validate the handle with `fileHandle.stat()` before streaming from that handle.

Concrete failure scenario:

The storage abstraction is not currently wired into the live upload/processing/serving path, so this is not a confirmed production exposure today. If a future caller uses `getStorage().createReadStream()` for public downloads, private originals, generated resources, or export bundles, a same-host actor or compromised writable upload subtree could swap the checked path after `lstat()` and before `createReadStream()`. The caller would then stream a different file than the one that passed the regular-file check.

Suggested fix:

Before integrating this backend into any user-facing read path, align it with `serve-upload.ts`: perform realpath containment checks, open a file handle, validate `fileHandle.stat()` on the opened handle, and stream from that handle. Where platform support allows it, add no-follow semantics for the open operation. Add a focused regression test that attempts a symlink/path swap against the storage backend contract.

## No-Finding Areas

- Admin backup/restore code already coordinates durable maintenance state, image queue quiescing, background write draining, SQL restore scanning, temp cleanup, and migration post-conditions. I did not find a fresh code-level defect in the reviewed restore path.
- Public pages and metadata paths checked in this pass use restore-maintenance guards or intentionally generic metadata before DB access. I did not find a current repeat of the stale cycle-29 metadata finding.
- Public DTO/privacy projections in `data.ts` still have explicit omit blocks, type-level privacy guards, and fixture-backed tests. I did not find a fresh public-field leak.
- Admin API routes and mutating server actions matched the expected auth/origin/rate-limit patterns in the reviewed files.
- Semantic and similar search routes enforce same-origin, request-size limits, mode gates, public enrichment fields, and hard scan caps. Remaining architectural scaling risk is recorded in the architect report rather than duplicated here as a code-quality bug.

## Final Sweep

Skipped or limited areas:

- I did not run the full lint/typecheck/build/test suite because this prompt requested review artifacts only and no product code changes.
- I did not manually inspect every historical `.context/**` artifact beyond current-cycle relevance and stale-finding comparison.
- I did not execute browser or production deploy flows.

Review conclusion:

One low-severity likely issue was found in dormant storage code. No confirmed live-path code-quality, logic, SOLID, maintainability, or cross-file interaction defect was found in current HEAD from the code-reviewer perspective.
