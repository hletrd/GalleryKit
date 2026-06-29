# Code Reviewer Report - Cycle 18

HEAD reviewed: `88706b96f0c3b8ddf50a2828fdfaa7e7cfb8db21`
Branch: `master`
Scope: comprehensive static review of cycle 18 relevant code, tests, and docs from code quality, logic, SOLID, maintainability, and cross-file correctness angles.
Mode: read-only review only. No implementation changes were made.

Outcome: 1 confirmed issue, 1 likely issue, and 1 risk needing manual validation. No critical or high-severity issue was confirmed in this pass.

## Review Inventory

Instructions and project context read before findings:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/archive/code-reviewer-c17.md`
- `.context/reviews/verifier.md`
- `.context/plans/archive/128-cycle18-fixes.md`
- `.context/plans/archive/64-deferred-cycle18.md`

Primary delta inventory reviewed from `5e054f80..88706b96`:
- Docs and review history: `README.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-17-2026-06-30-plan.md`, `.context/plans/cycle-17-2026-06-30-deferred.md`, `.context/reviews/*.md`, `.context/reviews/ui-ux-artifacts-cycle17/admin-login-mobile.png`
- Runtime/config: `apps/web/.env.local.example`, `apps/web/README.md`, `apps/web/nginx/default.conf`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- Static checkers: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- PWA/static runtime: `apps/web/public/sw.js`, `apps/web/public/sw.template.js`
- Public pages and routing: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- Server actions and routes: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`
- Cross-file dependencies inspected for the reviewed invariants: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`
- Components and libraries: `apps/web/src/components/search.tsx`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/validation.ts`
- Focused tests reviewed: `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, `apps/web/src/__tests__/bulk-update-images.test.ts`, `apps/web/src/__tests__/cycle-7-source-contracts.test.ts`, `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts`, `apps/web/src/__tests__/locale-path.test.ts`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`, `apps/web/src/__tests__/nginx-config.test.ts`, `apps/web/src/__tests__/semantic-route-production.test.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/strip-gps-from-original.test.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`, `apps/web/src/__tests__/validation.test.ts`

Validation commands/evidence used during review:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- A direct `checkPublicRouteSource()` probe confirmed the transitive local-mutator false negative described in CR18-CR-01.

## Confirmed Issues

### CR18-CR-01 - Public route rate-limit scanner misses transitive local mutators

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/scripts/check-public-route-rate-limit.ts:124-127`
- `apps/web/scripts/check-public-route-rate-limit.ts:129-150`
- `apps/web/scripts/check-public-route-rate-limit.ts:256-286`
- `apps/web/scripts/check-public-route-rate-limit.ts:355-360`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:364-381`

Problem:
The public mutating-route scanner now detects a one-hop local helper that directly calls `db.insert`, `db.update`, `db.delete`, `transaction`, `query`, or `execute` before a rate-limit gate. It does not compute the transitive closure of local mutating helpers. `localMutatingFunctions` is built by scanning each local function only for a direct `isKnownMutationCall()` match, so a helper that calls another local mutating helper is not marked as mutating. The later handler scan then treats that wrapper call as non-mutating and can accept a late limiter.

Concrete failure scenario:
This shape passes the scanner even though it writes before charging the public rate limit:

```ts
import { preIncrementShareAttempt } from '@/lib/rate-limit';

async function actuallyWrite() {
  await db.insert(rows).values({ ok: true });
}

async function writeFirst() {
  await actuallyWrite();
}

async function guarded(ip: string) {
  await writeFirst();
  const limit = preIncrementShareAttempt(ip);
  if (limit) return { status: 429 };
  return { status: 200 };
}

export { guarded as POST };
```

The existing regression at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:364-381` catches only the one-hop `writeFirst() -> db.insert()` case. A two-hop `guarded() -> writeFirst() -> actuallyWrite() -> db.insert()` route is reported as `OK: route.ts (uses rate-limit helper)`.

Suggested fix:
Compute `localMutatingFunctions` to a fixed point. Mark a local function mutating when its body either directly calls a known mutation method or calls any already-known local mutating function, then repeat until no new names are added. Use that transitive set in both handler scanning and local gate validation. Add a negative fixture for the two-hop example above so future refactors cannot reintroduce the blind spot.

## Likely Issues

### CR18-CR-02 - Bulk tag edits can skip image freshness when combined with a no-op scalar update

Severity: MEDIUM
Confidence: Medium

Code regions:
- `apps/web/src/app/actions/images.ts:1057-1068`
- `apps/web/src/app/actions/images.ts:1123-1155`
- `apps/web/src/db/schema.ts:97-100`
- `apps/web/src/lib/data.ts:509-524`
- `apps/web/src/lib/data.ts:828-852`
- `apps/web/src/lib/data.ts:1628-1637`
- `apps/web/src/app/feed.xml/route.ts:37-72`
- `apps/web/src/app/sitemap.ts:34-80`
- `apps/web/src/__tests__/bulk-update-images.test.ts:532-570`

Problem:
`bulkUpdateImages()` relies on the schema-level `updated_at` `onUpdateNow()` behavior for scalar image updates, and only performs an explicit `images.updated_at = CURRENT_TIMESTAMP` touch for tag mutations when `Object.keys(setClause).length === 0`. That means tag add/remove mutations are explicitly freshened only in the pure tag-only path.

The likely gap is the mixed path: if the bulk request includes a scalar field in `setClause` but that scalar update is a no-op for one or more selected images, the later tag insert/delete can still change public content while the image row timestamp is not explicitly touched. MySQL auto-updated timestamp columns do not advance when all other columns are set to their current values, so this branch depends on actual scalar value changes to carry the tag freshness invariant.

Concrete failure scenario:
An admin selects images, sets the topic to the same topic those rows already have, and adds a new tag. `setClause` is non-empty because `topic.mode === 'set'`, so the tag freshness branch at `apps/web/src/app/actions/images.ts:1152-1155` is skipped. If the topic assignment is a no-op for those rows, the only real data change is the `image_tags` insert. Public tags change, but `images.updated_at` may stay unchanged. Feed ordering and entry `<updated>` use `getImagesForFeed()` ordered by `images.updated_at` (`apps/web/src/lib/data.ts:828-852`), and sitemap `<lastmod>` uses `images.updated_at` (`apps/web/src/lib/data.ts:1628-1637`, `apps/web/src/app/sitemap.ts:34-80`), so crawlers/feed readers may miss or de-prioritize the changed photo content.

The focused tag tests at `apps/web/src/__tests__/bulk-update-images.test.ts:532-570` assert insertion/deletion behavior but do not assert freshness in the mixed scalar-plus-tag branch.

Suggested fix:
Whenever `tagMutationRows > 0`, explicitly touch `images.updated_at` for `existingImageIds`, regardless of whether `setClause` was non-empty. This can be a separate update after tag mutations, or `updated_at: sql\`CURRENT_TIMESTAMP\`` can be folded into scalar update paths while still preserving an explicit post-tag touch for mixed no-op cases. Add a regression that combines a scalar `mode: 'set'` operation with a tag mutation and asserts the timestamp touch is issued.

## Risks Needing Manual Validation

### CR18-CR-03 - Resolved-path streaming comments overstate TOCTOU protection

Severity: LOW
Confidence: Medium

Code regions:
- `apps/web/src/app/api/admin/db/download/route.ts:50-75`
- `apps/web/src/app/api/admin/db/download/route.ts:78-84`
- `apps/web/src/lib/serve-upload.ts:175-217`
- `apps/web/src/lib/serve-upload.ts:239-267`
- `apps/web/src/__tests__/resolved-stream-source.test.ts:15-18`

Problem:
Both backup download and upload-derivative serving validate path containment with `lstat()` plus `realpath()`, then later call `createReadStream(resolvedPath)`. The comments say streaming from the resolved path closes the TOCTOU gap where a file could be replaced by a symlink between validation and stream creation. That statement is too strong: the code still opens by pathname after validation, and the response metadata is computed from the pre-open `stats` object.

This is not a confirmed remotely exploitable bug in the reviewed production threat model because an attacker would need write access to the relevant host filesystem paths. It is still a correctness and maintainability risk because future reviewers/tests may believe the race is fully closed.

Concrete failure scenario:
A local process with write access to `data/backups` replaces a validated backup file between `realpath(filePath)` and `createReadStream(resolvedFilePath)`. The route logs and returns `Content-Length` from the old `lstat()` result (`apps/web/src/app/api/admin/db/download/route.ts:68-84`) but streams whatever object is opened at the resolved pathname. The same metadata/body mismatch can occur for derivative serving: the ETag and `Content-Length` are built from `stats` at `apps/web/src/lib/serve-upload.ts:175-217`, while the body is opened later at `apps/web/src/lib/serve-upload.ts:263-267`.

Suggested fix:
If the threat model requires real TOCTOU closure, open the file descriptor first with symlink rejection where supported, `fstat()` the opened descriptor, verify file type and containment assumptions against the opened object, and stream from that descriptor or `FileHandle.createReadStream()`. If the current local-write threat model is accepted, weaken the comments and the source-contract test so they do not claim path-based `createReadStream(resolvedPath)` closes the race.

## Final Sweep

Relevant file classes not skipped:
- Project instructions and detailed architecture docs were read before code review.
- Changed cycle files were inventoried from git and reviewed by functional area, not sampled randomly.
- Security scanners and their tests were reviewed together with the route patterns they are meant to protect.
- Server actions were checked against origin/auth, transaction, timestamp freshness, audit, and revalidation behavior.
- Public API routes were checked against request-size guards, rate limiting, content-type parsing, and admin/token authentication surfaces.
- Upload and image-processing paths were checked against GPS stripping, HDR gates, restore-maintenance gates, quota accounting, queueing, and rollback cleanup.
- Locale, sitemap, feed, public page, service worker, cache, and ETag logic were checked for cross-file freshness and URL correctness.
- Nginx route/body-size/rate-limit config was checked against the Lightroom upload, admin API, and derivative-serving route shapes.
- i18n message files were included in the inventory; no key-shape issue was found in the reviewed changed surfaces.
- Existing regression tests were inspected for each finding area, and the test gaps above are called out where present.
