# Verifier Review - Cycle 18/100

Date: 2026-06-30 KST
HEAD reviewed: `88706b96d90e7cd3bab9006fc6797e88ef737200` (`fix(review): close cycle 17 findings`)
Scope: evidence-check current HEAD against `AGENTS.md`, `CLAUDE.md`, cycle-17 plan/review claims, implementation, tests, lint gates, deploy assumptions, and runtime/build behavior. This review did not implement fixes.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventoried and inspected:

- Cycle-17 contracts: `.context/reviews/_aggregate.md`, `.context/reviews/verifier.md`, `.context/plans/cycle-17-2026-06-30-plan.md`, `.context/plans/cycle-17-2026-06-30-deferred.md`
- Fix diff from `5e054f80..88706b96`
- Auth/origin/rate-limit gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- Changed action/API paths: `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`
- Runtime/deploy/cache paths: `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`
- Validation and route behavior: `apps/web/src/lib/validation.ts`, `apps/web/src/lib/locale-path.ts`, public home/timeline/year pages, touched unit tests, package scripts/config

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Focused regression tests: `npm test --workspace=apps/web -- check-public-route-rate-limit.test.ts check-action-origin.test.ts tags-actions.test.ts strip-gps-from-original.test.ts images-action-gps-toggle-wiring.test.ts lr-upload-hdr-gate.test.ts sw-template-contract.test.ts validation.test.ts locale-path.test.ts nginx-config.test.ts`: 12 files passed, 259 tests passed.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed.
- `npm test --workspace=apps/web`: 260 files passed, 2 skipped; 2432 tests passed, 4 skipped.
- `npm run build --workspace=apps/web`: passed. Warning observed: sitemap fell back to homepage-only because local MySQL at `127.0.0.1:3306` refused connection; this matches the cycle-17 plan's known local-build warning.
- `git diff --check`: passed.
- Probe: direct `checkPublicRouteSource()` invocation still passes a two-hop local mutator before a limiter; details below.

## Findings

### V18-01 - Public route rate-limit scanner still misses transitive local mutators

Severity: Medium
Confidence: High

Files and regions:

- `apps/web/scripts/check-public-route-rate-limit.ts:124-145`
- `apps/web/scripts/check-public-route-rate-limit.ts:212-241`
- `apps/web/scripts/check-public-route-rate-limit.ts:269-285`
- `apps/web/scripts/check-public-route-rate-limit.ts:355-360`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-381`
- `.context/plans/cycle-17-2026-06-30-plan.md:14`

Issue:

Cycle 17 scheduled `AGG-C17-03` as done: local-helper false negatives should be closed by treating local mutator helpers as mutations. The implementation now detects direct local mutators (`localMutatingFunctions`) and the tests cover an exported helper that directly calls a direct mutator. It does not compute the transitive call graph. A helper that calls another helper that performs the DB mutation is not marked mutating, so the exported route can still mutate before rate limiting while the blocking lint gate passes.

Concrete failure scenario:

This probe against the current scanner returned `OK: route.ts (uses rate-limit helper)`:

```ts
import { preIncrementShareAttempt } from '@/lib/rate-limit';

async function writeFirst() {
  await db.insert(rows).values({ ok: true });
}

async function helperA() {
  await writeFirst();
}

export async function POST() {
  await helperA();
  const limit = preIncrementShareAttempt('1.2.3.4');
  if (limit.limited) return Response.json({}, { status: 429 });
  return Response.json({ ok: true });
}
```

A future public API route can hide a write behind a two-hop local helper and still pass `npm run lint:public-route-rate-limit --workspace=apps/web`. That weakens the exact security invariant this lint gate is meant to enforce.

Suggested fix:

Build local mutator detection to a fixed point: a local function is mutating if it directly calls a known mutator or calls another local function already classified as mutating. Use that transitive set in both helper-body and exported-handler scans. Add a negative fixture matching the two-hop example above, plus a variable-function variant if the scanner intends to support variable local helpers.

### V18-02 - `serve-upload` still documents a one-day cache lifetime beside a one-hour header

Severity: Low
Confidence: High

Files and regions:

- `apps/web/src/lib/serve-upload.ts:247-254`
- `apps/web/next.config.ts:63-72`
- `apps/web/nginx/default.conf:173-176`
- `CLAUDE.md:204`
- `CLAUDE.md:299`
- `.context/plans/cycle-17-2026-06-30-plan.md:18`

Issue:

Cycle 17 scheduled cache-comment drift as done, and the docs/config consistently state derivative uploads use `Cache-Control: public, max-age=3600, must-revalidate`. One response-header comment in `serve-upload.ts` still says edge caches keep the file "fast for one day" immediately above the actual one-hour header.

Concrete failure scenario:

A future maintainer edits route-handler cache behavior and trusts the local comment instead of the header and cross-doc contract. They can reintroduce a 24-hour route-handler cache or make operational decisions assuming derivative freshness is one day, while the rest of the repo and tests assume one hour.

Suggested fix:

Change the stale comment at `serve-upload.ts:247-253` to "one hour" and keep it aligned with `next.config.ts`, nginx, and `CLAUDE.md`. A small source-contract test can grep this specific comment if repeated drift remains a problem.

### V18-03 - Backup download still claims the TOCTOU gap is closed while reopening by pathname

Severity: Low
Confidence: Medium

Files and regions:

- `apps/web/src/app/api/admin/db/download/route.ts:43-75`
- `.context/plans/cycle-17-2026-06-30-deferred.md:10-16`

Issue:

The deferred plan correctly records this as open (`C17-D01`), but the implementation comment still says streaming from the resolved realpath closes the TOCTOU gap. The route validates `lstat(filePath)`, `realpath(filePath)`, and containment, then opens a new pathname with `createReadStream(resolvedFilePath)`. That is safer than opening the user-derived path, but it is still not descriptor-backed validation of the opened object.

Concrete failure scenario:

An attacker with same-host write access to the backup directory, or a compromised same-UID process, races the interval between validation and `createReadStream()`. The route can validate one file object and then stream a replacement at the same resolved pathname. This is not an unauthenticated web exploit under the current operator-boundary model, which is why the deferred plan can reasonably keep it open, but the source comment overstates the guarantee.

Suggested fix:

Either implement fd-based open/fstat/stream-from-fd semantics with symlink rejection where supported, or change the comment to say the route reduces but does not eliminate the race. Keep the deferral entry until descriptor-backed serving is implemented or backup storage changes.

## Verified Closures

I did not find current mismatches for these cycle-17 scheduled fixes:

- Tag freshness: tag rename/delete and direct/batch tag link mutations now update affected `images.updated_at` inside transactions (`apps/web/src/app/actions/tags.ts:82-98`, `apps/web/src/app/actions/tags.ts:130-144`, `apps/web/src/app/actions/tags.ts:201-212`, `apps/web/src/app/actions/tags.ts:269-281`, `apps/web/src/app/actions/tags.ts:365-373`, `apps/web/src/app/actions/tags.ts:438-508`).
- Action-origin try/catch: catch/finally branches are processed independently before the try block can set a later rate-limit gate (`apps/web/scripts/check-action-origin.ts:391-404`), and the current probe fails unsafe catch mutation.
- GPS stripping: browser and Lightroom uploads now reject/clean up originals when `strip_gps_on_upload` is enabled and `stripGpsFromOriginal()` returns false (`apps/web/src/app/actions/images.ts:382-395`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`, `apps/web/src/lib/process-image.ts:1733-1818`).
- Home list DB failure: the home page no longer catches the image-list query as an empty success; it awaits `getImagesLitePage()` directly (`apps/web/src/app/[locale]/(public)/page.tsx:149-167`).
- Reserved topic route segments: `c`, `privacy`, `timeline`, and `year` are now reserved (`apps/web/src/lib/validation.ts:4-24`) with tests.
- Service worker photo pages: `/p/:id` is excluded from offline HTML cache (`apps/web/public/sw.template.js:58-64`), and generated `sw.js` was regenerated during build.
- Proxy chain preservation: nginx now uses `$proxy_add_x_forwarded_for` on proxied locations (`apps/web/nginx/default.conf:67-70`, repeated across the file), and docs/tests describe the trusted-hop topology.

## Final Missed-Issues Sweep

Final sweeps covered:

- The full `5e054f80..HEAD` fix diff and all files touched by the cycle-17 implementation commit.
- Cycle-17 scheduled vs deferred findings, checking whether DONE claims match code and tests.
- Current custom lint gates, standard ESLint, typecheck, full unit tests, production build, and `git diff --check`.
- Docs vs code for upload cache headers, proxy trust, semantic production setup/copy, GPS stripping, route reservations, and service-worker offline exclusions.
- Security-critical scanner behavior using both committed tests and direct probes.

No additional confirmed critical or high-severity issues were found. Remaining risk is concentrated in security-tooling precision and low-severity doc/comment drift, plus the intentionally deferred backup TOCTOU hardening.
