# Plan 246 — Cycle 1 Fresh Review Deferred Items
Status: active-deferred

Purpose: record every Cycle 1 fresh review finding not scheduled for direct implementation in `plan/plan-245-cycle1-fresh-fixes.md`. Original severity/confidence are preserved; no review finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: "Keep diffs small, reviewable, and reversible"; "No new dependencies without explicit request."
- `CLAUDE.md`: the shipped deployment is explicitly "single web-instance / single-writer"; local filesystem is the only supported storage backend; TypeScript 6 / Next.js 16 are documented project baselines.
- Existing `.context/**` and `plan/**`: broad architectural refactoring, operational config changes, and documentation improvements are carried as dedicated tracks rather than mixed into small hardening cycles.

## Deferred items

### D-C1F-02 — CSP `style-src` includes `'unsafe-inline'` in production
- **Finding:** C1-F02.
- **Citation:** `apps/web/src/lib/content-security-policy.ts:64`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** accepted Tailwind CSS / Radix UI trade-off. Removing `'unsafe-inline'` from `style-src` requires migrating to CSS modules or nonce-based style injection, which is a major architectural change. The `script-src` directive correctly uses nonces (the more critical CSP directive).
- **Exit criterion:** Tailwind CSS supports nonce-based style injection, or the project migrates to CSS modules / CSS-in-JS with nonce support.

### D-C1F-03 — Rate-limit logic duplicated across 5+ modules
- **Finding:** C1-F03.
- **Citation:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/public.ts:38-74`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** architectural refactoring that touches every rate-limited surface (login, search, load-more, OG, password change). Each surface has slightly different semantics (DB-backed vs in-memory, `RateLimitEntry` vs `{ count, resetAt }`, rollback patterns). Extracting a generic rate-limiter class requires careful design to avoid breaking the existing TOCTOU pre-increment pattern.
- **Exit criterion:** a new rate-limited surface is added (justifying the abstraction), or a dedicated rate-limit refactoring cycle is scheduled.

### D-C1F-04 — `getClientIp` returns "unknown" when `TRUST_PROXY` not set
- **Finding:** C1-F04.
- **Citation:** `apps/web/src/lib/rate-limit.ts:105-111`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** operational configuration issue, not a code bug. The code already warns at line 108 when proxy headers are detected without `TRUST_PROXY=true`. Changing the default would break non-proxy deployments. The Docker Compose documentation recommends `TRUST_PROXY=true`.
- **Exit criterion:** production deployment is found running without `TRUST_PROXY` behind a proxy, or a startup-time warning is added (not just per-request).

### D-C1F-07 — `original_format`/`original_file_size` in `adminSelectFields` inflate listing queries
- **Finding:** C1-F07.
- **Citation:** `apps/web/src/lib/data.ts:466-488`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** already deferred as D-C8RPF-07 (admin dashboard list over-fetches full admin image records). The deferred plan entry covers this finding.
- **Exit criterion:** admin dashboard projection refactor is scheduled.

### D-C1F-09 — Backup download reveals symlink existence via 403 vs 404
- **Finding:** C1-F09.
- **Citation:** `apps/web/src/app/api/admin/db/download/route.ts:60-66`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** admin-only route with same-origin + auth checks. The information disclosure is limited to authenticated admins who already have full database access. Fixing this would require merging the `lstat` and `realpath` code paths, which adds complexity for minimal security benefit.
- **Exit criterion:** threat model changes to include untrusted admin accounts, or a defense-in-depth pass is scheduled.

### D-C1F-13 — Session `expiresAt` comparison timezone assumption
- **Finding:** C1-F13.
- **Citation:** `apps/web/src/lib/session.ts:139`.
- **Original severity / confidence:** LOW / LOW.
- **Reason for deferral:** theoretical timezone concern. Both MySQL `TIMESTAMP` (stored in UTC) and Node.js `new Date()` (typically UTC in Docker) use UTC by convention. The Drizzle ORM reads `TIMESTAMP` as JavaScript `Date` objects. No actual timezone mismatch has been observed.
- **Exit criterion:** a timezone-related session bug is reported, or the session module is refactored.

### D-C1F-14 — `publicSelectFields` vs `adminSelectFields` pattern requires 3-step update
- **Finding:** C1-F14.
- **Citation:** `apps/web/src/lib/data.ts:115-201`.
- **Original severity / confidence:** LOW / HIGH.
- **Reason for deferral:** the compile-time guard at line 197-200 catches any omissions at build time. The 3-step process (add to admin, add to omit list, add to guard type) is a maintenance concern but not a security vulnerability. Changing the pattern would require a significant refactor of the field selection mechanism.
- **Exit criterion:** a developer misses the 3-step process and the compile-time guard catches it (validating the guard's value), or a cleaner pattern is proposed.

### D-C1F-15 — `actions/images.ts` is a god module (432 lines)
- **Finding:** C1-F15.
- **Citation:** `apps/web/src/app/actions/images.ts`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** code organization improvement. Breaking up the module would require extracting shared types, revalidation logic, and cleanup helpers into separate files. This is a style refactor with no functional benefit.
- **Exit criterion:** the module grows beyond 500 lines, or a new function is added that warrants a separate file.

### D-C1F-16 — No structured error types for server action results
- **Finding:** C1-F16.
- **Citation:** `apps/web/src/app/actions/*.ts`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** architectural design decision. Adding structured error types (enum codes + message keys) requires defining an error code taxonomy, updating all server actions, and updating all client-side error handling. This is a broad API change.
- **Exit criterion:** a new error code is needed that cannot be represented by a translated string, or client-side error handling becomes unmanageable.

### D-C1F-17 — Photo viewer sidebar transition uses `transition-all`
- **Finding:** C1-F17.
- **Citation:** `apps/web/src/components/photo-viewer.tsx:416-417`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** cosmetic UX improvement. The `transition-all` animation works correctly but may be slightly janky on very slow devices. Changing to specific property transitions requires testing across browsers and devices.
- **Exit criterion:** user-reported animation jank, or the component is refactored.

### D-C1F-18 — `searchImages` runs up to 3 sequential DB queries
- **Finding:** C1-F18.
- **Citation:** `apps/web/src/lib/data.ts:793-880`.
- **Original severity / confidence:** LOW / HIGH.
- **Reason for deferral:** already deferred as D-C8RPF-10 (live search lacks a real search index). The sequential queries are a performance concern for large galleries, not a correctness issue. The short-circuit optimization already handles the common case (popular search terms).
- **Exit criterion:** search latency becomes user-visible, or a search index is implemented.

### D-C1F-19 — `getImage()` prev/next queries are complex and potentially slow
- **Finding:** C1-F19.
- **Citation:** `apps/web/src/lib/data.ts:514-583`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** performance concern for large galleries. The current implementation is correct and functional. Optimizing the prev/next queries requires either cursor-based navigation or denormalized position columns.
- **Exit criterion:** gallery grows beyond 10,000 images and prev/next navigation shows measurable latency.

### D-C1F-20 — CLAUDE.md schema section omits `adminSettings`, `auditLog`, `rateLimitBuckets`
- **Finding:** C1-F20.
- **Citation:** `CLAUDE.md` Database Schema section.
- **Original severity / confidence:** INFO / HIGH.
- **Reason for deferral:** documentation improvement. Adding these tables to the CLAUDE.md schema section is a doc-only change with no functional impact.
- **Exit criterion:** next CLAUDE.md documentation pass, or a new contributor is confused by the missing tables.

### D-C1F-21 — CLAUDE.md deployment step references `site-config.example.json`
- **Finding:** C1-F21.
- **Citation:** `CLAUDE.md` Deployment Checklist section.
- **Original severity / confidence:** INFO / MEDIUM.
- **Reason for deferral:** documentation verification. Checking whether `site-config.example.json` exists and the deployment instructions are accurate.
- **Exit criterion:** next deployment documentation pass, or a new deployer is confused by the missing example file.

### D-C1F-09-TE — Test gap: `processImageFormats` atomic rename fallback chain
- **Finding:** C1-TG02.
- **Citation:** `apps/web/src/lib/process-image.ts:437-452`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** test gap for a rarely-exercised fallback path. The fallback only triggers on broken filesystems. Adding tests requires mocking `fs.link` and `fs.rename`, which adds test complexity for minimal coverage value.
- **Exit criterion:** a production incident involves the fallback chain, or the filesystem interaction code is refactored.

### D-C1F-10-TE — Test gap: `flushGroupViewCounts` backoff during DB outages
- **Finding:** C1-TG03.
- **Citation:** `apps/web/src/lib/data.ts:16-96`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** test gap for approximate analytics. The view count is explicitly "best-effort" per CLAUDE.md. The backoff logic is straightforward but untested.
- **Exit criterion:** view counts become contractual data, or the data layer test seam is scheduled.

### D-C1F-11-TE — Test gap: `searchImages` three-query sequential path
- **Finding:** C1-TG04.
- **Citation:** `apps/web/src/lib/data.ts:774-880`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** test gap for a complex query path. The tag/alias search branches are only triggered when main results are insufficient. Direct testing requires mocking the DB layer at the data.ts level.
- **Exit criterion:** a search regression is reported, or the search query is refactored.
