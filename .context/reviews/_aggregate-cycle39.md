# Aggregate Review — Cycle 39 (2026-04-19)

## Summary

Cycle 39 review of the full codebase found **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed 8 previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C39-01: `batchUpdateImageTags` remove path still uses slug-only lookup [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 309-318
- **Flagged by**: code-reviewer (CR-39-01), debugger (DBG-39-01), verifier (VER-39-01)
- **Cross-agent agreement**: 3 agents flagged this
- **Description**: The C38-01 fix for `removeTagFromImage` added name-first lookup to prevent removing the wrong tag during slug collisions. However, the remove loop inside `batchUpdateImageTags` was not updated — it still uses slug-only lookup (`eq(tags.slug, slug)`). When two tags produce the same slug (e.g., "SEO" and "S-E-O"), this code path removes the wrong tag-image association.
- **Fix**: Apply the same name-first, slug-fallback lookup pattern from `removeTagFromImage` to the remove loop in `batchUpdateImageTags`.

### C39-02: Mobile bottom sheet GPS dead code not annotated (incomplete C38-02 fix) [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/info-bottom-sheet.tsx` lines 288-301
- **Flagged by**: code-reviewer (CR-39-04), designer (UX-39-03), verifier (VER-39-02)
- **Cross-agent agreement**: 3 agents flagged this
- **Description**: C38-02 added a comment to the unreachable GPS block in `photo-viewer.tsx`, but the same unreachable GPS block exists in the mobile `info-bottom-sheet.tsx` without the annotation. The fix was incomplete — only one of two components was annotated.
- **Fix**: Add the same unreachable-GPS comment block to `info-bottom-sheet.tsx`.

### C39-03: Admin user creation form labels not associated with inputs [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/admin-user-manager.tsx` lines 93-98
- **Flagged by**: code-reviewer (CR-39-03), debugger (DBG-39-03), designer (UX-39-01)
- **Cross-agent agreement**: 3 agents flagged this
- **Description**: The "Create User" dialog uses `<label>` elements without `htmlFor` attributes, and the `<Input>` elements lack matching `id` attributes. Clicking label text does not focus the corresponding input. Screen readers cannot associate labels with fields (WCAG 2.2 Level A, criterion 1.3.1).
- **Fix**: Add `htmlFor` to labels and matching `id` to inputs (e.g., `htmlFor="create-username"` / `id="create-username"`, `htmlFor="create-password"` / `id="create-password"`).

## Additional Findings (Lower Priority)

### SEC-39-01: Locale cookie missing `Secure` flag [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/nav-client.tsx` line 60
- **Flagged by**: security-reviewer (SEC-39-01)
- **Cross-agent agreement**: 1 agent
- **Description**: The `NEXT_LOCALE` cookie is set with `SameSite=Lax` but without `Secure` flag. Non-sensitive cookie but inconsistent with session cookie practice.
- **Fix**: Add `Secure` flag when on HTTPS.

### SEC-39-03: `sql-restore-scan.ts` does not check `SET @@global.` pattern [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/sql-restore-scan.ts` lines 1-30
- **Flagged by**: security-reviewer (SEC-39-03)
- **Cross-agent agreement**: 1 agent
- **Description**: The dangerous SQL patterns list includes `SET GLOBAL` but not `SET @@global.`. A crafted SQL dump could use `SET @@global.variable = value` to bypass the filter. The `--one-database` flag on the mysql client provides additional protection.
- **Fix**: Add `/\bSET\s+@@global\./i` to the dangerous SQL patterns list.

### UX-39-02: Admin user creation form lacks password confirmation [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/admin-user-manager.tsx` line 98
- **Flagged by**: designer (UX-39-02)
- **Cross-agent agreement**: 1 agent
- **Description**: Admin user creation has only one password input with no confirmation. A typo in the password would lock out the new admin account. The password change form correctly has confirmation.
- **Fix**: Add a password confirmation input and validate both match client-side.

### CR-39-02: `processImageFormats` unlink-before-link race window [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 381-389
- **Flagged by**: code-reviewer (CR-39-02), debugger (DBG-39-02)
- **Cross-agent agreement**: 2 agents
- **Description**: Brief window where base file doesn't exist after unlink before link/copy. Queue is serialized so practically impossible but theoretically present.
- **Fix**: Write to temp file and rename atomically.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-38 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps

## Agent Failures

None — all review agents completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager, etc.), SQL restore scanning (sql-restore-scan.ts), safe JSON-LD serialization, image URL construction.
