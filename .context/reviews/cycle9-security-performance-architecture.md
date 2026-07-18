# Cycle 9 Security, Performance, and Architecture Review

Review target: `f50e96b31d04dae85cdd73eb2a99e816c8b403e7` (`master == origin/master`). Review only; no application code changed.

## Inventory and method

I read `AGENTS.md`, all of `CLAUDE.md`, the current aggregate and role reviews,
the Cycle 8 plan, and the consolidated carry-forward register before inspecting
the maintained repository. The inventory covered 516 source `.ts` files, 113
source `.tsx` files, all 12 App Router route files, action modules, 31 migration
SQL files plus journal/reconcile machinery, unit and browser tests, package and
build configuration, Docker/nginx/deploy assets, scripts, and repository
ledgers. I traced the complete Cycle 8 change from responsive-size policy through
main/archive/shared consumers and tests, then performed repository-wide security,
resource, query, concurrency, and module-boundary sweeps.

Verdict: **zero new security findings, zero new performance findings, and one
low-severity architecture/workflow finding.** Existing accepted or deferred
risks are listed separately and were not re-filed.

## Security review

### New findings

**Zero.**

The review covered OWASP-style authorization and access control, cryptography
and secret handling, injection, insecure design, configuration, dependency
exposure, authentication/session/PAT behavior, logging, SSRF/origin trust, and
file/process boundaries. In particular:

- Session tokens are HMAC-authenticated, stored only as SHA-256 hashes, bounded
  to 24 hours, checked against the database, and production refuses a missing or
  short environment secret (`apps/web/src/lib/session.ts:8-35,82-150`).
- Cookie-authenticated admin APIs verify trusted same-origin provenance before
  session authorization and add no-store/nosniff defaults; PAT requests retain
  explicit scope, expiry/revocation, pre-increment rate-limit, and context
  cleanup behavior (`apps/web/src/lib/api-auth.ts:95-150`; `apps/web/src/lib/request-origin.ts:81-145`).
- Login advances both IP and normalized-account buckets before Argon2 work and
  checks durable counters (`apps/web/src/app/actions/auth.ts:100-175`). The
  action/API/public-route guard lints found no unwrapped or exempted mutation.
- Backup download validates the filename, lexical and real paths, opens the
  already-validated descriptor, checks it is a regular file, audits access, and
  streams with no-store headers (`apps/web/src/app/api/admin/db/download/route.ts:21-108`).
- Restore input is size-bounded, written to a random `0600` temporary file,
  validated before import, fenced from uploads/background mutations, and run by
  an argument-array child with a watchdog (`apps/web/src/app/[locale]/admin/db-actions.ts:789-860` and the subsequent restore block). The scanner's admin/operator
  trust boundary and shipped database grants remain unchanged; no current bypass
  of an application trust boundary was confirmed.
- Public upload serving delegates to the shared containment/realpath/ETag/abort
  implementation, and the primary HEAD path does not open a discarded stream
  (`apps/web/src/app/uploads/[...path]/route.ts:1-30`). Privacy projections,
  GPS opt-in joins, and the symmetric sensitive-key test passed.
- A tracked-file secret scan found examples/test fixtures only. The production
  dependency audit reported zero vulnerabilities. The Cycle 8 responsive change
  introduces no credential, authorization, SQL, filesystem, network, or privacy
  boundary.

## Performance review

### New findings

**Zero.**

The Cycle 8 source-policy helper performs a fixed, tiny amount of string and
arithmetic work per rendered masonry surface. It now describes the same capped,
padded container geometry used by the main, archive, and nested shared grids;
unit and browser evidence exercises the candidate-crossing boundaries. No new
observer, listener, cache, hydration, query, or image-processing fan-out was
introduced.

The repository sweep rechecked listing/feed/map/search query limits and index
shape, N+1 and fan-out behavior, DB connection hold time, upload/restore memory,
Sharp and CLIP concurrency, retry/bootstrap queues, process-local maps and sets,
stream cancellation, service-worker accounting, and responsive image selection.
The shared pool remains capped at 10 connections with a queue limit, TLS is
mandatory for non-local databases unless explicitly disabled, and image workers
derive concurrency from that pool budget (`apps/web/src/db/index.ts:7-45`;
`apps/web/src/lib/image-queue.ts:100-152`). Public map output remains hard-capped
at 10,000 rows (`apps/web/src/lib/data.ts:1766-1816`). Semantic endpoints remain
rate-limited and cap their brute-force vector scans; production uses normalized
dot products (`apps/web/src/app/api/search/semantic/route.ts:263-311`;
`apps/web/src/app/api/search/similar/[id]/route.ts:177-214`). These known scale
ceilings did not change in Cycle 8.

## Architecture review

### ARCH-C9-01 — Cycle 8's repository frontier still claims its signed publication is pending

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed current workflow-state defect; deployment state requires manual validation**
- Regions: `.context/plans/cycle-8-2026-07-18-plan.md:3-5,91-100`;
  `.context/plans/README.md:51-57`

The active Cycle 8 plan says “signed release pending” and leaves “Signed commits
pushed” unchecked. At the reviewed frontier, however, `master` and
`origin/master` both resolve to `f50e96b31d04dae85cdd73eb2a99e816c8b403e7`,
and `git log --show-signature -1` reports a good GPG signature. The recently
completed index stops at Cycle 7. A fresh agent recovering solely from the
committed plan therefore receives a false publication frontier and can repeat
already-completed terminal work. Production deployment cannot be inferred from
the Git refs and remains a separate manual-verification item.

Fix: reconcile Cycle 8's plan and the plan index with the signed pushed SHA,
archive it according to the current convention, and record deploy state only
from actual deploy evidence. To stop the recurring Cycle N+1 repair pattern,
make signed-push reconciliation an explicit terminal artifact or document that
the next cycle owns this unavoidable post-publication transition.

Beyond this workflow state, no new layering, coupling, or runtime-topology
break survived review. The responsive policy is centralized in one helper and
reused by main/archive/shared consumers. Browser and Lightroom upload producers
currently forward the same processing snapshot fields
(`apps/web/src/app/actions/images.ts:485-517`;
`apps/web/src/app/api/admin/lr/upload/route.ts:565-602`). Migration state remains
mirrored by reconcile logic and guarded by the migration post-condition test.

## Revalidated carry-forward risks — not new findings

- The 250 MiB Server Action parser boundary can still materialize multipart
  bodies before restore code streams the `File` to disk
  (`apps/web/next.config.ts:116-125`; `db-actions.ts:789-810`). Browser/LR upload
  ingress has the related large-body RSS ceiling. The carry-forward memory exit
  criteria did not fire.
- Image processing, backfills, analytics, and live traffic share the same DB/CPU
  budget. Local concurrency caps are present, but global admission control is a
  deferred scale item; this release did not add a producer or raise a cap.
- The application intentionally ships as one web instance. The singleton guard
  is warn-only and process-local restore/upload/rate-limit state is not safe for
  horizontal scale-out (`apps/web/src/lib/single-writer-guard.ts:6-46`). No
  topology change was made.
- Browser and Lightroom upload orchestration remains duplicated but its current
  processing-setting contract is in parity. The existing consolidation exit
  criterion did not fire.
- Semantic scan, 10,000-marker map, leading-wildcard/keyword search, CSV/service-
  worker scale, plaintext operator backups, host-applied nginx/proxy policy,
  local-only storage abstraction, and build/runtime config distinctions remain
  tracked in `.context/plans/deferred-carry-forward.md`. None was newly exposed
  or worsened by Cycle 8.

## Validation and final missed-issue sweep

Fresh checks at the review target:

- ESLint: passed.
- App and script typecheck: passed.
- `lint:api-auth`: passed.
- `lint:action-origin`: passed.
- `lint:public-route-rate-limit`: passed.
- Production dependency audit: passed, zero vulnerabilities.
- Focused Vitest: 10 files, 405 tests passed (auth/origin/route guards, privacy,
  SQL restore scanner, session, upload serving, responsive masonry, and migration
  reconcile coverage).
- `git diff --check`: passed.

The final sweep revisited every route/action export, origin and proxy fallback,
PAT scope/use tracking, cookie/session lifecycle, privacy field symmetry,
filesystem and symlink containment, child-process construction, SQL scanner and
migration promotion, bounded maps/queues, abort/finalizer cleanup, pool overlap,
query limits/indexes, upload producer parity, configuration lifetime, PWA/runtime
boundaries, single-writer assumptions, and the complete Cycle 8 diff. No second
current architecture issue and no security or performance defect survived source,
test, and history validation.
