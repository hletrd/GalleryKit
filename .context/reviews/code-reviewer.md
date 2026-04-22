# Cycle 12 Code Reviewer Notes

## Scope and inventory

Repo-wide review completed across the tracked, review-relevant surfaces under `/Users/hletrd/flash-shared/gallery`:

- root docs/config/scripts: `README.md`, `package.json`, `scripts/`, Docker/deploy wiring
- app config/deploy: `apps/web/Dockerfile`, `docker-compose.yml`, `next.config.ts`, `playwright.config.ts`, `drizzle.config.ts`
- application source: `apps/web/src/app/**`, `components/**`, `lib/**`, `db/**`, `i18n/**`, `instrumentation.ts`, `proxy.ts`
- tests: `apps/web/src/__tests__/**`, `apps/web/e2e/**`
- localization/config payloads: `apps/web/messages/*.json`, `apps/web/src/site-config.example.json`

Skipped only non-source/generated/runtime/vendor material (`node_modules/`, `.git/`, `.omx/`, `.omc/`, `test-results/`, binary fixtures/assets except where behaviorally relevant).

## Grounding / verification

- `git diff --stat` → clean working tree for code under review
- `npx tsc -p apps/web/tsconfig.json --noEmit` → passed
- `npm run lint --workspace=apps/web -- .` → passed
- `npm run test --workspace=apps/web` → passed (`30` files, `159` tests)
- targeted grep/pattern sweeps completed for logging, empty catches, TODO/FIXME/skip markers, process-local state, share key handling, restore flow, and tag slug handling
- `omx_code_intel` MCP diagnostics/search transport was unavailable during this cycle, so shell-based typecheck/lint/grep inspection was used instead

Finding count: 6

---

## Confirmed issues

### C12-01 — Unicode tag slugs are accepted at write time but rejected by the public filtering path
- **Severity:** HIGH
- **Confidence:** HIGH
- **Type:** Confirmed issue
- **Citations:**
  - `apps/web/src/lib/validation.ts:34-35`
  - `apps/web/src/lib/tag-records.ts:5-12`
  - `apps/web/src/lib/data.ts:277-289`
  - `apps/web/src/app/actions/public.ts:17-21`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-40,111-118`
- **Problem:**
  - Tag creation now explicitly allows Unicode slugs (`isValidTagSlug()` accepts `\p{Letter}` / `\p{Number}` and `getTagSlug()` preserves non-ASCII letters/numbers), but the public read/query path still hard-rejects anything outside `/^[a-z0-9-]+$/i`.
  - That means the write-side contract and read-side contract disagree.
- **Concrete failure scenario:**
  - An admin creates a tag like `서울` or `桜`, attaches it to images, and the topic page renders that tag as an available filter.
  - Visiting `/<topic>?tags=서울` (or loading more results with that active filter) silently drops the tag filter inside `buildTagFilterCondition()` / `loadMoreImages()`, so the user sees unrelated images and infinite-scroll pages no longer match the selected chip.
- **Suggested fix:**
  - Replace the duplicated ASCII regexes in `data.ts` and `public.ts` with a shared validator based on `isValidTagSlug()`.
  - Keep all tag-slug parsing/normalization in one shared helper so write-side and read-side rules cannot drift again.

### C12-02 — EXIF datetime parsing still accepts impossible calendar dates and later normalizes them into different timestamps
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Type:** Confirmed issue
- **Citations:**
  - `apps/web/src/lib/process-image.ts:117-149`
  - `apps/web/src/lib/exif-datetime.ts:1-17`
- **Problem:**
  - `parseExifDateTime()` only range-checks `day <= 31`, so values like `2024:02:31 10:00:00` pass.
  - `formatStoredExifDate()` / `formatStoredExifTime()` then feed the stored string back through `Date.UTC(...)`, which normalizes impossible dates instead of rejecting them.
- **Concrete failure scenario:**
  - A malformed camera/edited EXIF block contains `2024:02:31 10:00:00`.
  - The upload path persists `2024-02-31 10:00:00`, but the formatter later displays March 2nd, so the stored value, displayed value, sort order, and metadata no longer agree.
- **Suggested fix:**
  - After regex capture, construct a UTC `Date`, then round-trip-check that year/month/day/hour/minute/second still match the original fields before accepting.
  - Reuse the same validator in both parse and display paths so old bad values are rejected or surfaced explicitly instead of silently normalized.

### C12-03 — The container health check still treats database reachability as liveness, so transient DB outages can trigger restart loops
- **Severity:** HIGH
- **Confidence:** HIGH
- **Type:** Confirmed issue
- **Citations:**
  - `apps/web/Dockerfile:75-77`
  - `apps/web/src/app/api/health/route.ts:6-16`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:243-287`
- **Problem:**
  - Docker health probes call `/api/health`, and that route returns HTTP 503 whenever the DB query fails.
  - That makes a dependency outage/readiness problem look like the Node process itself is dead.
- **Concrete failure scenario:**
  - During a database restart, network flap, or admin restore window, `/api/health` flips to 503.
  - Docker marks the container unhealthy and restarts it even though the app process is still serving and could recover once the DB comes back, interrupting in-flight restore/queue work and potentially creating a restart loop.
- **Suggested fix:**
  - Split health endpoints into at least `live` (process is up) and `ready` (DB reachable).
  - Point Docker `HEALTHCHECK` at liveness only; reserve DB-aware readiness for orchestration/monitoring.

### C12-04 — Backup/restore is presented as an admin safety net, but it only snapshots SQL and not the filesystem-backed image corpus
- **Severity:** HIGH
- **Confidence:** HIGH
- **Type:** Confirmed issue
- **Citations:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:102-233,243-340`
  - `apps/web/src/lib/upload-paths.ts:11-46`
  - `README.md:149-162`
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:131-219`
- **Problem:**
  - The admin UI exposes backup/restore as a straightforward recovery tool, but the implementation only dumps/restores MySQL.
  - The actual gallery corpus lives partly in `/app/data/uploads/original` and partly in `public/uploads` derivatives, outside the SQL dump.
- **Concrete failure scenario:**
  - An operator restores a `.sql` backup onto a fresh host/container without the matching upload volumes.
  - The DB rows come back, but originals/derivatives do not, so public pages point at missing files and the processing queue cannot reconstruct already-imported images from SQL alone.
- **Suggested fix:**
  - Either: (a) explicitly downgrade the feature/UI/docs to “database-only backup/restore” and block/strongly warn when file volumes are not snapshotted alongside it, or (b) implement a coordinated archive/snapshot flow that includes DB + original uploads + generated derivatives.

---

## Likely issues

### C12-05 — Share-link entropy and uniqueness still depend on the database collation, but the schema never forces case-sensitive storage
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Type:** Likely issue
- **Citations:**
  - `apps/web/src/lib/base56.ts:3-4`
  - `apps/web/src/db/schema.ts:29,89`
  - `apps/web/src/lib/data.ts:492-507,534-554`
  - `apps/web/src/app/actions/sharing.ts:116-161,217-266`
- **Problem:**
  - Share keys use a mixed-case Base56 alphabet, but both `images.share_key` and `shared_groups.key` are plain `varchar(...).unique()` columns with no explicit binary/case-sensitive collation.
  - On the common case-insensitive MySQL collations, keys that differ only by case compare equal.
- **Concrete failure scenario:**
  - `AbC...` and `aBc...` are distinct keys at the generator level, but the DB treats them as duplicates (or the lookup becomes case-insensitive), shrinking the effective key space and causing avoidable `ER_DUP_ENTRY` retries / looser-than-intended matching.
- **Suggested fix:**
  - Force a binary/case-sensitive collation on both share-key columns (or store them in a binary column).
  - If that is undesirable operationally, constrain the generator alphabet to one case so storage and comparison semantics match the token design.

---

## Risks needing manual validation

### C12-06 — Restore maintenance is still enforced through process-local state, so multi-instance deployments can bypass the fence
- **Severity:** HIGH
- **Confidence:** MEDIUM
- **Type:** Risk needing manual validation
- **Citations:**
  - `apps/web/src/lib/restore-maintenance.ts:1-56`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:253-284`
  - `apps/web/src/app/actions/images.ts:82-90,205-209`
  - `apps/web/src/lib/image-queue.ts:136-145,292-345,347-369`
- **Problem:**
  - The restore gate is a `globalThis` symbol flag, so it only protects the current Node process.
  - Multiple app instances/processes will not observe each other’s maintenance state.
- **Concrete failure scenario:**
  - Restore starts on instance A and correctly pauses A’s queue + blocks A’s writes.
  - A load balancer sends an upload/admin mutation to instance B, which still sees `active=false`, accepts the write, and/or reboots the queue against a database being restored.
- **Suggested fix:**
  - Move the maintenance flag to a shared primitive every instance can read atomically (DB row, Redis, dedicated advisory lock + explicit read path).
  - Make queue bootstrap and all mutating actions consult that shared state instead of a process-local symbol.

---

## Final missed-issues sweep

Performed an explicit final sweep for:
- TODO/FIXME/HACK markers
- skipped tests in review-relevant surfaces
- process-local mutable state
- duplicated regex validators for slugs/keys
- share-key schema/lookup mismatches
- restore-flow interactions with queue/upload code
- deployment/runtime coupling between Docker health checks and DB readiness

No additional repo-wide correctness issues rose above the threshold of the findings documented above.
