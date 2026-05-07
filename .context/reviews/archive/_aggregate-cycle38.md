# Aggregate Review — Cycle 38 (2026-04-19)

## Summary

Cycle 38 review of the full codebase found **5 new actionable issues** (1 MEDIUM, 4 LOW) and confirmed 8 previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C38-01: `removeTagFromImage` removes by slug, not by exact tag name [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 159-181
- **Flagged by**: code-reviewer (CR-38-03), debugger (DBG-38-01), verifier (VER-38-01), critic (CRI-38-02)
- **Cross-agent agreement**: 4 agents flagged this or its root cause
- **Description**: `removeTagFromImage` derives a slug from `tagName` and looks up the tag by slug. When two tags produce the same slug (collision, e.g., "SEO" and "S-E-O" both slug to "s-e-o"), this removes the wrong tag-image association. The `addTagToImage` function warns about collisions, but `removeTagFromImage` silently removes by slug.
- **Fix**: Look up by name first (`eq(tags.name, cleanName)`), fall back to slug only if no exact name match. Consider using tag IDs instead of names for removal operations.

### C38-02: Dead GPS display code in public PhotoViewer [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` lines 470-483
- **Flagged by**: security-reviewer (SEC-38-01), critic (CRI-38-03)
- **Cross-agent agreement**: 2 agents
- **Description**: The GPS coordinates display in PhotoViewer is unreachable because `selectFields` (used by `getImage`) excludes `latitude` and `longitude`. The `canShare` prop is based on `isAdmin()`, but even admin users viewing the public photo page get data from `getImageCached()` which uses `selectFields`. This dead code could mislead future developers into thinking GPS data is available.
- **Fix**: Remove the dead GPS display code or add a clear comment explaining it's unreachable in the current query path. If GPS should be shown to admins, create an admin-specific data accessor that includes these fields.

### C38-03: Upload dropzone file removal button only visible on hover (touch accessibility) [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/upload-dropzone.tsx` lines 288-295
- **Flagged by**: designer (UX-38-05)
- **Cross-agent agreement**: 1 agent
- **Description**: The file removal button uses `opacity-0 group-hover:opacity-100` with `focus:opacity-100` for keyboard users. On touch devices, there's no hover state, so users have no visual indication that a remove action exists.
- **Fix**: Make the button always visible on small screens: `sm:opacity-0 sm:group-hover:opacity-100 opacity-100`.

### C38-04: Back-to-top button accessible when invisible [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/home-client.tsx` lines 334-348
- **Flagged by**: designer (UX-38-02)
- **Cross-agent agreement**: 1 agent
- **Description**: The back-to-top button uses `opacity-0 pointer-events-none` when hidden, but remains focusable by keyboard and announced by screen readers. This violates WCAG accessibility guidelines.
- **Fix**: Add `aria-hidden={showBackToTop ? undefined : true}` and `tabIndex={showBackToTop ? 0 : -1}`.

### C38-05: Image manager select-all checkbox lacks indeterminate state [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/image-manager.tsx` lines 293-300
- **Flagged by**: designer (UX-38-04)
- **Cross-agent agreement**: 1 agent
- **Description**: The "select all" checkbox doesn't use the `indeterminate` property when some (but not all) images are selected. WCAG recommends this pattern for select-all checkboxes.
- **Fix**: Add a `ref` to the checkbox and set `indeterminate = selectedIds.size > 0 && selectedIds.size < images.length` in an effect.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-37 remain deferred:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit (also CR-38-01)
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion (also CR-38-04)
- C30-06: Tag slug regex inconsistency (related to C38-01 root cause)
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)

## Agent Failures

None — all review agents completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, etc.), SQL restore scanning (sql-restore-scan.ts), E2E tests.
