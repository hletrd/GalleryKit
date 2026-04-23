# Aggregate Review — Cycle 3 (2026-04-19)

**Source reviews:** cycle3-comprehensive-review (multi-angle deep review)

## Summary

Cycle 3 review of the full codebase found **2 new findings** (1 MEDIUM, 1 LOW). Both are accessibility improvements. No CRITICAL or HIGH findings. No regressions from prior cycles. No security, correctness, or data-loss issues. The codebase remains in strong shape after 37 prior cycles of fixes.

All 12 findings from the previous cycle-3 review file were verified as already resolved in current code.

## Findings

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C3-F01 | Upload dropzone `<label>` not associated with `<select>` via `htmlFor`/`id` | MEDIUM | HIGH | `apps/web/src/components/upload-dropzone.tsx:222-234` |
| C3-F02 | Admin image manager checkboxes use native `<input>` instead of Checkbox component | LOW | HIGH | `apps/web/src/components/image-manager.tsx:283-288,303-309` |

### C3-F01: Upload label not associated with select (MEDIUM)

Two `<label>` elements in the upload dropzone lack `htmlFor`/`id` association with their controls. Screen readers will not announce the label text when the controls receive focus. Violates WCAG 2.2 SC 1.3.1 and SC 4.1.2.

**Fix:** Add `id="upload-topic"` to the `<select>` and `htmlFor="upload-topic"` to the `<label>`. Similarly for the tags label/wrapper.

### C3-F02: Admin checkboxes use native input (LOW)

The "select all" and per-image checkboxes in the admin image manager use raw `<input type="checkbox">` instead of the shadcn/ui `Checkbox` component. While they have `aria-label`, they lack design-system consistency.

**Fix:** Replace with `<Checkbox>` from `@/components/ui/checkbox`.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)

## Review Coverage

- All server actions (auth, images, topics, tags, sharing, admin-users, public)
- Middleware (proxy.ts)
- Data layer (data.ts, cache deduplication, view count buffering)
- Image processing pipeline (process-image.ts, image-queue.ts)
- Auth & session management (session.ts, api-auth.ts)
- Rate limiting (rate-limit.ts, auth-rate-limit.ts)
- Upload security (serve-upload.ts, upload-limits.ts)
- DB schema (schema.ts)
- DB connection (index.ts)
- Admin pages (dashboard, db, password, users, categories, tags)
- Public pages (photo, shared group, shared photo, topic, home)
- API routes (health, og, db download)
- Instrumentation & graceful shutdown
- Validation (validation.ts)
- Audit logging (audit.ts)
- i18n & locale paths
- Frontend components (image-manager, upload-dropzone, photo-viewer, tag-input, home-client, nav, admin-header, admin-nav, lightbox, etc.)
- SQL restore scanning (sql-restore-scan.ts)
- Admin DB actions (db-actions.ts)

## AGENT FAILURES

None — single reviewer completed successfully.

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **1 LOW** finding recommended for implementation
- **0 CRITICAL/HIGH** findings
- **2 total** unique findings
