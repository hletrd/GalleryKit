# Verifier Review - Cycle 17/100

Date: 2026-06-30 KST
HEAD reviewed: `5e054f80f646cbcd16c7aae5412aa29424e05032` (`fix(cycle16): 🐛 close review-plan-fix findings`)
Scope: evidence-based correctness review against `AGENTS.md`, `CLAUDE.md`, committed `.context` plan/review history, tests, and current HEAD implementation. This review did not implement fixes.

## Contract Inventory And Evidence

Reviewed `AGENTS.md` and `CLAUDE.md` first, then inventoried the current contract surfaces:

- Auth guards: `withAdminAuth(...)` route wrapper, same-origin cookie auth, token scope support, scanner `lint:api-auth`, server-action origin scanner `lint:action-origin`.
- Upload limits: 200 MiB file cap, 2 GiB rolling app quota, 100-file batch cap, Next action/proxy 266 MiB effective cap, nginx 216M upload route cap, LR route behavior, restore-maintenance guards.
- Color/HDR: `IMAGE_PIPELINE_VERSION = 7`, no culling/scoring, admin-only HDR delivery, color metadata persistence, derivative cache/ETag/SW freshness, backfill parity.
- Migrations: journal monotonicity after historical inversions, hash postconditions, `reconcileLegacySchema` coverage, legacy schema cleanup.
- Privacy: public/admin field separation, GPS/map gating, search enrichment sensitive-field guard.
- Rate limits: public action/API pre-increment contracts, rollback only when DB increment succeeded, analytics/IP privacy.
- Deploy/service worker/semantic search/analytics: deployment rules, generated `sw.js`, semantic production gate, analytics retention and no full IP persistence.

Evidence commands/read-only probes:

- Verified current HEAD and clean starting state with `git rev-parse HEAD`, `git log -1`, and `git status --short`.
- Read key source/test regions in `apps/web/src/lib/api-auth.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, upload actions/routes, service worker template/generated file, migration runner/journal, privacy/data selectors, semantic routes, analytics/rate-limit modules, and relevant tests.
- Confirmed generated `public/sw.js` matches `scripts/build-sw.ts` output for the current template and `IMAGE_PIPELINE_VERSION`.
- Ran a targeted `tsx` probe against `checkPublicRouteSource()` to confirm the public route scanner false negative described below.

## Findings

### V17-01 - Confirmed - Tag-link freshness postcondition is not atomic

Severity: Medium
Confidence: High
Files:

- `apps/web/src/app/actions/tags.ts:176-196`
- `apps/web/src/app/actions/tags.ts:238-259`
- `apps/web/src/app/actions/tags.ts:328-336`
- `apps/web/src/app/actions/tags.ts:396-480`
- `.context/plans/cycle-16-2026-06-30-plan.md:13-17`
- `apps/web/src/__tests__/tags-actions.test.ts:119-256`

Contract:

Cycle 16 marked the feed/sitemap freshness fix complete: tag-only changes must touch the parent image's `updated_at` when tag links are actually inserted/deleted, to prevent stale `lastModified` and false feed 304 behavior (`.context/plans/cycle-16-2026-06-30-plan.md:13-17`). `CLAUDE.md:400` also states public gallery/photo surfaces are freshness-sensitive and should show async processing/metadata updates immediately.

Implementation mismatch:

The tag-link mutation and the parent-image timestamp touch are separate writes in every tag-link path:

- `addTagToImage()` inserts into `imageTags` at `tags.ts:176-179`, then updates `images.updated_at` later at `tags.ts:193-196`.
- `removeTagFromImage()` deletes from `imageTags` at `tags.ts:238-242`, then updates `images.updated_at` later at `tags.ts:256-259`.
- `batchAddTags()` inserts links at `tags.ts:328`, then updates `images.updated_at` at `tags.ts:333-336`.
- `batchUpdateImageTags()` commits all add/remove work inside `db.transaction()` at `tags.ts:396-460`, then updates `images.updated_at` outside that transaction at `tags.ts:477-480`.

Concrete failure scenario:

An admin adds or removes a tag. The `imageTags` write succeeds, but the subsequent `db.update(images).set({ updated_at: CURRENT_TIMESTAMP })` fails because of a transient DB error, connection interruption, lock timeout, or because the row was concurrently deleted after the tag-link write. In the single/batch-add paths, the action can return an error after already changing tags; in `batchUpdateImageTags()`, the action can throw after the transaction has committed. In both cases, the feed/sitemap freshness postcondition can be false: tags changed, but `images.updated_at` did not advance, so consumers using `updated_at` can miss the change or keep a false 304.

The unit coverage currently exercises validation/collision/no-op audit behavior, but does not simulate `images.updated_at` update failure or assert rollback/postcondition behavior (`tags-actions.test.ts:119-256`). That leaves the "DONE" freshness fix under-proven.

Suggested fix:

Make the tag-link mutation and `images.updated_at` touch one atomic DB unit for each path. For `batchUpdateImageTags()`, move the timestamp update inside the existing transaction when `added > 0 || removed > 0`. For the single and batch-add paths, wrap the link mutation plus timestamp update in a transaction or explicitly verify/update the parent image before returning success. Add tests where the timestamp update fails and assert either the tag-link mutation rolls back or the action reports a clearly partial failure with a repair path.

### V17-02 - Confirmed false-confidence risk - Public API rate-limit scanner still passes a helper that mutates before limiting

Severity: Medium
Confidence: High
Files:

- `apps/web/scripts/check-public-route-rate-limit.ts:124-127`
- `apps/web/scripts/check-public-route-rate-limit.ts:129-244`
- `apps/web/scripts/check-public-route-rate-limit.ts:271-276`
- `apps/web/scripts/check-public-route-rate-limit.ts:345-349`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-361`

Contract:

`AGENTS.md` and `CLAUDE.md` make `npm run lint:public-route-rate-limit --workspace=apps/web` a blocking gate: every public API route exporting a mutating handler must call a rate-limit pre-increment helper before mutation, unless it carries an explicit exemption. Cycle 16 specifically scheduled the "public API scanner local-helper blind spot" as fixed (`.context/plans/cycle-16-2026-06-30-plan.md:17`).

Implementation mismatch:

The checker only classifies direct property-access DB calls as mutations (`isKnownMutationCall()` at `check-public-route-rate-limit.ts:124-127`). It builds `localRateLimitGateFunctions` by accepting any local function whose own body appears to contain a rate-limit gate before a known mutation (`check-public-route-rate-limit.ts:271-276`), then treats calls to those local functions as satisfying exported handlers (`check-public-route-rate-limit.ts:345-349`).

Because `bodyCallsRateLimitBeforeMutation()` does not treat calls to local mutating helper functions as mutations (`check-public-route-rate-limit.ts:129-244`), this fixture incorrectly passes:

```ts
import { preIncrementShareAttempt } from '@/lib/rate-limit';

async function writeFirst() {
  await db.insert(rows).values({ ok: true });
}

async function guarded() {
  await writeFirst();
  const limit = preIncrementShareAttempt('1.2.3.4');
  if (limit.limited) return Response.json({}, { status: 429 });
  return Response.json({ ok: true });
}

export { guarded as POST };
```

I confirmed the current scanner returns:

```json
{
  "passed": ["OK: route.ts (uses rate-limit helper)"],
  "failed": []
}
```

Current tests cover a good local gate helper and an ignored-rate-limit helper (`check-public-route-rate-limit.test.ts:326-361`), but not a local helper that performs the mutation before the gate.

Concrete failure scenario:

A future public `POST` route factors its write into `writeFirst()` and calls that helper before rate limiting inside another local function. The blocking scanner passes, CI gives false confidence, and the deployed route accepts unlimited writes until a human notices.

Suggested fix:

Mirror the stronger local-mutator analysis used by the action-origin scanner: collect local functions/variables whose bodies contain known mutations, treat calls to those functions as mutations while scanning both local gate helpers and exported handlers, and add a regression fixture matching the example above. Fail closed on unresolved local helper calls in mutating public route handlers if precision is uncertain.

### V17-03 - Risk - Backup download still reopens by pathname after validation

Severity: Low
Confidence: Medium
Files:

- `apps/web/src/app/api/admin/db/download/route.ts:43-75`

Contract:

The admin DB backup download route must confine downloads to `data/backups`, reject symlinks/non-files, and avoid path traversal. The route comment claims it streams from the resolved realpath to "close the TOCTOU gap" (`route.ts:72-74`).

Implementation mismatch:

The route validates containment with `lstat(filePath)` and `realpath(filePath)` (`route.ts:43-64`), then calls `createReadStream(resolvedFilePath)` (`route.ts:75`). That is safer than opening the original request path, but it is still a second pathname open after validation. If an attacker with same-host filesystem write access can replace the validated backup file between `realpath()` and `createReadStream()`, Node will open whatever path now exists at `resolvedFilePath`.

Concrete failure scenario:

This is not an app-level unauthenticated exploit; it requires a local writer or compromised same-UID process that can race files under `data/backups`. Under that condition, an admin download request could validate one file and stream another same-path replacement. If the replacement is a symlink or hard link permitted by the filesystem context, the earlier checks no longer describe the opened object.

Suggested fix:

Do not claim the gap is closed unless the opened file descriptor is the same object that was validated. Prefer opening a file descriptor with flags that reject symlinks where available, `fstat()` the fd, validate the fd's metadata/containment assumptions, and stream from the fd. At minimum, update the comment to describe the residual race and add a source-level regression test around the intended open/validate order.

## Final Sweep

No additional confirmed mismatches found in these contracts during this pass:

- Admin API auth scanner: admin routes are wrapped with `withAdminAuth(...)`, and the scanner fails closed on alias/star export patterns.
- Server-action same-origin scanner: current scanner covers mutating exports, public-action rate-limit-before-mutation exemptions, and the cycle-16 catch/finally traversal hardening.
- Upload limits and LR upload: current caps and nginx/Next limits match the documented proxy-vs-rolling-quota distinction; LR upload resolves cookie actor attribution and PAT scope paths.
- Privacy selectors: public/search/map selectors exclude the sensitive fields guarded by `privacy-fields.test.ts`.
- Migrations: current journal has the expected historical non-monotonic section and newer monotonic entries; `migrate.js` retains hash postconditions and legacy reconciliation coverage.
- Color/HDR and service worker: generated `sw.js` matches the template/pipeline version; HEAD timeout/offline exclusions are represented in template tests.
- Semantic search: production mode remains opt-in by `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, and public semantic routes gate same-origin, body size, query length, and rate limits.
- Analytics: current view-event paths rate-limit without persisting full IPs, and retention purge code is present.

Residual risk is concentrated in scanner precision and postcondition atomicity rather than missing top-level guards.
