# Plan 239 — Cycle 8 fresh: deferred backlog (LOW items not implemented this cycle)

**Source:** Cycle-8 fresh aggregate, items not promoted to plans 233–238.
**Severity for all listed items:** LOW.
**Reason for deferral:** none of these are correctness or security defects requiring immediate fix; they are hygiene / future-scale / micro-perf items. Repo policy explicitly allows LOW deferral with documented exit criteria (CLAUDE.md repo-rules ordering: this is not security/correctness/data-loss).

Each entry below records: file+region citation, original severity/confidence, deferral reason, exit criterion to re-open.

---

### AGG8F-03 — `global-error.tsx` imports full `site-config.json`
- **Citation:** `apps/web/src/app/global-error.tsx:4`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Bundle-size impact is small for the canonical example config. Operators with large custom configs can address proactively.
- **Exit criterion:** A bundle-size CI check shows the client bundle attributable to `global-error.tsx` exceeding 5 KB after gzip.

### AGG8F-04 — Audit-log metadata silent truncation at 4096
- **Citation:** `apps/web/src/lib/audit.ts:24-29`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Truncation is gracefully signaled via `{truncated: true, preview}`. The 4096 cap is configurable in code if observed to be insufficient.
- **Exit criterion:** A real incident review references a truncated audit row whose missing context impeded resolution.

### AGG8F-06 — `images.view_count` overflow at 2.1B
- **Citation:** `apps/web/src/db/schema.ts:90`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Personal-gallery scope makes the overflow theoretical. Migration to `bigint` is mechanical and can land later.
- **Exit criterion:** Any deployed instance reports `view_count > 1_000_000_000` for any group.

### AGG8F-07 — `adminUsers.created_at` lacks `.notNull()`
- **Citation:** `apps/web/src/db/schema.ts:106-111`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Default clause prevents NULL on normal insert. Schema cosmetics.
- **Exit criterion:** Any future code path explicitly inserts `created_at: null` for an admin user.

### AGG8F-08 — `global-error.tsx` lacks try/catch around DOM read
- **Citation:** `apps/web/src/app/global-error.tsx:42`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Speculative; the helper is small and DOM access during fatal-error rendering has not been observed to fail.
- **Exit criterion:** A production crash log shows the brand-detection helper throwing inside global-error.

### AGG8F-09 — Audit-log upload failures do not include sanitized filenames
- **Citation:** `apps/web/src/app/actions/images.ts:407-412`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Failure filenames already log to `console.error`. Audit-log addition is a nice-to-have for centralized post-mortem flow.
- **Exit criterion:** A post-mortem requires correlation between failed-upload audit entry and filename without console-log access.

### AGG8F-10 — `.gif/.bmp` originals accepted but not served as derivatives
- **Citation:** `apps/web/src/lib/process-image.ts:42`, `apps/web/src/lib/serve-upload.ts:13-17`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Asymmetry is documented internally; Sharp processing of GIF/BMP into AVIF/WebP/JPEG works.
- **Exit criterion:** A user reports being unable to view a GIF or BMP they uploaded.

### AGG8F-11 — Dockerfile `prod-deps` runs unguarded postinstall scripts
- **Citation:** `apps/web/Dockerfile:32`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Supply-chain hardening; not a current-state vulnerability. `npm ci` enforces lockfile integrity.
- **Exit criterion:** A CVE in any postinstall path of a transitive dep is published.

### AGG8F-12 — No `state.shuttingDown` flag exposed to mutating actions
- **Citation:** `apps/web/src/instrumentation.ts:8-15`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Reverse proxies typically drain traffic before SIGTERM; the 15s window rarely accepts new mutations.
- **Exit criterion:** A production restart shows partial commits attributable to in-flight mutations during shutdown.

### AGG8F-13 — `verifySessionToken` cache could memoize stale state post-password-change
- **Citation:** `apps/web/src/lib/session.ts:94`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Speculative; current control flow does not exhibit the problem.
- **Exit criterion:** A new code path is added that calls `getCurrentUser()` after `updatePassword` in the same request.

### AGG8F-14 — `nginx/default.conf` declares Permissions-Policy in two places
- **Citation:** `nginx/default.conf:39, 110`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Defense-in-depth, not a defect.
- **Exit criterion:** A future header-update PR fails to update one of the two locations.

### AGG8F-15 — `getImagesLitePage` uses `COUNT(*) OVER()` window function
- **Citation:** `apps/web/src/lib/data.ts:359-392`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Acceptable performance for current dataset sizes. Replacement requires benchmarking.
- **Exit criterion:** Page-load latency on `/` exceeds 500ms p95 for a deployment with > 50K images.

### AGG8F-16 — Hourly GC interval runs DELETEs sequentially
- **Citation:** `apps/web/src/lib/image-queue.ts:444-449`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** 10-30ms savings is negligible for an hourly job.
- **Exit criterion:** None; this is permanent low-priority unless the GC starts contending with hot-path queries.

### AGG8F-17 — `loadMoreImages` re-throws on DB errors
- **Citation:** `apps/web/src/app/actions/public.ts:108-111`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Asymmetric vs `searchImagesAction` but not user-facing-visible until a DB outage.
- **Exit criterion:** A user reports the infinite-scroll UI freezing during a transient DB blip.

### AGG8F-18 — View-count flush interval too short to coalesce
- **Citation:** `apps/web/src/lib/data.ts:18`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Backoff handles the DB-outage case; coalescing under sustained legitimate traffic is not a measured concern.
- **Exit criterion:** Observed DB write QPS for `view_count` exceeds 50/s sustained.

### AGG8F-20 — Inconsistent public-route cache idioms
- **Citation:** Multiple files; design-level concern
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Each idiom is correct in isolation. A unified decision matrix is doc work.
- **Exit criterion:** A new contributor PR introduces a fourth idiom, OR confusion drives a regression.

### AGG8F-21 — Six rate-limit Maps duplicate the prune/rollback pattern
- **Citation:** `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `actions/public.ts`, `actions/sharing.ts`, `actions/admin-users.ts`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Architect explicitly says "defer until a 7th rate-limit type is added."
- **Exit criterion:** A 7th rate-limit Map is needed.

### AGG8F-22 — No `lint:api-rate-limit` companion lint
- **Citation:** Repo lint scripts
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** With only one public `/api/*` route currently, the lint is over-engineered. Plan 233 covers the only current hole.
- **Exit criterion:** A second public `/api/*` route is added.

### AGG8F-24 — No startup assertion against horizontal-scaling
- **Citation:** `apps/web/src/instrumentation.ts`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Documented in CLAUDE.md "Runtime topology"; no false-positive risk because the docs are clear.
- **Exit criterion:** An operator reports state divergence symptomatic of horizontal scaling.

### AGG8F-25 — No CI lint for contradictory route config exports
- **Citation:** Plan 234 fixes the only known instance
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** The single instance is fixed; preventive lint is over-engineering for now.
- **Exit criterion:** A second instance lands.

### AGG8F-27 — CLAUDE.md image-pipeline omits `IMAGE_MAX_INPUT_PIXELS_TOPIC`
- **Citation:** CLAUDE.md "Image Processing Pipeline" section
- **Severity/Confidence:** LOW / High
- **Deferral reason:** Plan 236 covers the env-doc audit comprehensively; can be folded into that fix on landing.
- **Exit criterion:** Plan 236 lands without picking up the topic-pixel cap.

### AGG8F-28 — `.context/` tracking convention undocumented
- **Citation:** CLAUDE.md repo-structure section
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Self-evident from the directory existing in git.
- **Exit criterion:** A new contributor asks "should I commit `.context/` files?"

### AGG8F-29 — Pre-cycle-5 rows may carry Unicode-formatting chars
- **Citation:** `images.title/description`, `topics.label`, `topic_aliases.alias`, `tags.name`, `admin_settings`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Single-admin gallery; admin's own historical input is trusted.
- **Exit criterion:** A specific render path exhibits visible bidi reorder from legacy data.

### AGG8F-30 — Korean uppercase tracking in `global-error.tsx` brand
- **Citation:** `apps/web/src/app/global-error.tsx:62-77`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Visible only in fatal-error rendering, which is rare.
- **Exit criterion:** A user reports awkward Hangul rendering on the error fallback.

### AGG8F-31 — `/api/og` uses platform sans-serif
- **Citation:** `apps/web/src/app/api/og/route.tsx:54`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Existing deferred backlog item (PERF-UX-02).
- **Exit criterion:** Brand-identity priority shifts to social previews.

### AGG8F-32 — `/api/og` topic label can overflow for CJK
- **Citation:** `apps/web/src/app/api/og/route.tsx:9`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Personal gallery; topic labels are admin-curated and easily kept short.
- **Exit criterion:** Admin reports a CJK topic label rendering off-canvas in a social share.

### AGG8F-33 — Default `AUDIT_LOG_RETENTION_DAYS = 90` shorter than OWASP guidance
- **Citation:** `apps/web/src/lib/audit.ts:52`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Personal-gallery scope; configurable env knob already exists. Plan 236 documents it.
- **Exit criterion:** Operator reports a regulatory requirement.

### AGG8F-34 — `check-action-origin.ts` lint relies on leading-comment match
- **Citation:** `apps/web/scripts/check-action-origin.ts`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** No formatter currently in use breaks the leading-comment shape.
- **Exit criterion:** A formatter change breaks the comment recognition.

### AGG8F-35 — Multi-cycle deferred backlog needs triage
- **Citation:** `.context/plans/plan-220-cycle6-rpl-deferred.md` and predecessors
- **Severity/Confidence:** LOW / High
- **Deferral reason:** Out of scope for an "every-cycle" fresh sweep. A single triage plan would walk the older items and either close them or schedule them.
- **Exit criterion:** A future cycle is dedicated to backlog hygiene rather than fresh review.

---

## Tracking summary

- **Items deferred this cycle:** 25
- **Items scheduled this cycle:** 6 (plans 233–238)
- **Re-opens from earlier cycles:** 0
- All deferred items are LOW severity. No MEDIUM or higher items are deferred.
