# architect — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## Architectural observations

### A-1. Rate-limit ordering contract is not machine-enforced
The invariant "validate form-field shape before incrementing rate-limit counter" is followed by `login` and `share*` but violated by `updatePassword` and partially by `createAdminUser`. No lint gate or static check can detect this ordering bug — it's a logical contract only.

Two possible architectural fixes:
1. **Helper function**: `async withRateLimit(ip, bucket, max, window, fn)` — takes the expensive `fn` as a callback. The helper owns the pre-increment and rollback flow; callers put validation in front of the helper call. Moves the ordering contract from "remember to do X before Y" to "use the helper correctly".
2. **State machine**: structure every rate-limited action as a sequence [preflight → validate → expensive → finalize]. A review comment or custom lint could scan for pre-increment statements not preceded by validation early-returns in the same function.

### A-2. Privacy field-selection indirection is excellent but visually obscure
The `adminSelectFields` / `publicSelectFields` pattern with rest-destructure omission and `_PrivacySensitiveKeys` type guard catches "add to admin but forget public" regressions at compile time. This is more rigorous than most codebases achieve. However, the implementation is concentrated in 90 lines of `data.ts` and is not extracted into its own module. Extraction to `lib/privacy-fields.ts` would:
- Make the contract visible in module imports.
- Separate schema shape from privacy policy.
- Let future per-route audits import the keys and assert on them.

### A-3. The lint gate scanner family is starting to duplicate TypeScript AST walking logic
`check-action-origin.ts` (267 lines) and `check-api-auth.ts` (167 lines) both do AST walks via `ts.createSourceFile` + manual `ts.isVariableStatement` / `ts.isFunctionDeclaration` branching. A shared helper in `apps/web/scripts/lib/ts-ast.ts` that exposes `forEachExport(source, (kind, name, node) => ...)` would reduce duplication and make future scanners (lint:action-maintenance, per AGG5R-12) cheaper to add.

### A-4. `revalidateAllAppData` is a heavyweight hammer
`revalidatePath('/', 'layout')` invalidates the entire app tree. This is correct for settings changes that affect every route (SEO, gallery settings), but it's also used after single-tag-add / single-topic-update operations via `revalidateAllAppData()` calls at the end of those actions (tags.ts:85, 124, topics.ts:125, 269, 340). A single tag rename does not need to bust every ISR entry.

Proposal: audit every `revalidateAllAppData()` call site. Replace with narrower `revalidateLocalizedPaths(...)` where only specific routes are affected.

### A-5. Maintenance state is a single process-global boolean
`restore-maintenance.ts` uses a `Symbol.for` global. In a multi-process deployment (PM2 cluster, multiple Docker replicas), one process entering restore maintenance does NOT prevent other processes from accepting uploads or running the queue. The advisory lock at the DB level (`gallerykit_db_restore`) covers the restore itself, but the app-level maintenance state is per-process.

This is documented at `image-queue.ts:165` ("Ignoring job while processing is unavailable") but CLAUDE.md doesn't surface the single-process assumption. For a self-hosted gallery this is usually fine (one app instance), but the assumption should be stated explicitly so operators planning horizontal scaling don't get bit.

## Carry-forward observations

- The actions/ surface is now organized by domain (auth, images, public, tags, topics, sharing, settings, seo, admin-users) — consistent and easy to navigate.
- Lint gates (api-auth + action-origin) are security-critical banners, preventing regressions in the auth gate and CSRF defense.
- Tests for the lint gates exist (`check-action-origin.test.ts`, `check-api-auth.test.ts`) — a departure from the "trust the CI" pattern towards "the scanner has its own test suite".

## Risk priorities

1. **A-1** (rate-limit ordering): HIGH priority as a process improvement, because C9R-RPL-01 demonstrates the failure mode.
2. **A-5** (single-process maintenance state): MEDIUM — documentation fix, not a code fix.
3. **A-4** (revalidateAllAppData overuse): MEDIUM perf — benchmark-gated.
4. **A-2, A-3**: LOW — cleanup/refactor.
