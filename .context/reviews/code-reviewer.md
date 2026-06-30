# Cycle 33 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `168c3837`
Date: 2026-06-30 KST
Scope: full-repository review lane. Report artifact only; no app/source files were edited by this lane.

## Inventory And Method

I read the workspace instructions from `AGENTS.md` and `CLAUDE.md`, then built a repository inventory before line-level review.

Inventory from this checkout:

- `rg --files -g '!node_modules' -g '!.next' -g '!dist' -g '!coverage'`: 816 tracked/unignored workspace files.
- `apps/web/src` TypeScript/TSX files: 519.
- `apps/web/src/__tests__` plus `apps/web/e2e` TypeScript/TSX files: 283.
- App route/page/action/db-action entry files under `apps/web/src/app`: 35.
- Library/component/db/script TypeScript/JavaScript files under `apps/web/src/lib`, `apps/web/src/components`, `apps/web/src/db`, and `apps/web/scripts`: 190.
- `apps/web/scripts` top-level scripts: 29.
- `apps/web/drizzle` migration/meta files: 32.

Primary surfaces examined:

- Admin and public routes: auth/session flows, `api/admin/*`, Lightroom upload, semantic/similar search, OG routes, health/live, public collection and photo pages.
- Server actions: images, tags, topics, collections, sharing, users, settings, SEO, embeddings, public analytics/load-more/search, database backup/restore.
- Core libraries: data access/privacy selections, rate limits, API auth, request-origin checks, session signing, image queue, Sharp processing, upload/storage paths, caption/alt-text flow, smart collections, CLIP/semantic search, SQL restore scanner, restore maintenance, config/env helpers.
- Scripts and migrations: `migrate.js`, Drizzle journal/meta, backup/restore helpers, semantic/color backfills, deploy/build/e2e helpers.
- Tests and contracts: action/API lint scanners, privacy guards, upload/restore locks, smart collection pagination, migration journal, alt-text fallback/stub-prefix behavior, sanitize/validation tests, source-contract tests.

Validation commands run:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Full lint/typecheck/build/Vitest/e2e were not run in this review-only lane.

## Summary

No critical or high-severity confirmed issue was found. The strongest confirmed issue is a medium-severity persistence-path gap where machine-derived `alt_text_suggested` can be copied into admin-managed title/description without the same sanitization and length checks used by normal admin metadata writes.

## Confirmed Issues

### C33-CODE-01 - Bulk applying suggested alt text bypasses admin string sanitization and field-length validation

Severity: Medium
Confidence: High

Exact citations:

- `apps/web/src/app/actions/images.ts:1102-1135`
- `apps/web/src/app/actions/images.ts:1138-1147`
- `apps/web/src/app/actions/images.ts:928-929`
- `apps/web/src/lib/sanitize.ts:161-190`
- `apps/web/src/lib/validation.ts:103-106`
- `apps/web/src/db/schema.ts:82-86`
- `apps/web/src/__tests__/bulk-update-images.test.ts:471-518`

Issue:

`bulkUpdateImages()` has a special path for `applyAltSuggested === 'title' || 'description'`. It reads `images.alt_text_suggested`, strips the `[AUTO]` prefix plus Unicode formatting characters, trims, and then writes the result directly to `images.title` or `images.description`.

That path does not use `sanitizeAdminString()` and does not enforce the normal title/description limits before persistence. The manual metadata paths in the same action sanitize admin strings before storing them (`images.ts:928-929`), and `sanitizeAdminString()` rejects C0/C1 controls plus Unicode formatting by returning `{ value: null, rejected: true }` (`sanitize.ts:161-190`). The apply-suggestion path only calls `stripUnicodeFormatting()` (`validation.ts:103-106`), which removes bidi/zero-width formatting but does not reject or strip control characters.

The length mismatch is also real: `alt_text_suggested` is a `text` column, while `title` is `varchar(255)` (`schema.ts:82-86`). Existing tests cover prefix stripping and empty suggestions, but not control-character rejection or overlong suggestion handling (`bulk-update-images.test.ts:471-518`).

Concrete failure scenario:

1. A legacy/restored row, future real caption producer, or producer bug leaves `alt_text_suggested` containing a C0/C1 control character, newlines/tabs, or more than 255 code points after prefix stripping.
2. An admin uses bulk edit to apply suggested alt text to `title` or `description`.
3. For `title`, MySQL may reject/truncate the value or fail the transaction because the source is `TEXT` and the destination is `varchar(255)`. For either field, control characters can be persisted into admin-managed metadata even though direct admin entry rejects them.

Suggested fix:

Run the stripped suggestion through the same admin metadata contract before copying it. For example, apply `sanitizeAdminString(stripped)` and skip or return a field-specific validation error when `rejected` is true. Enforce `countCodePoints(caption) <= 255` for `title` and the existing description limit for `description` before queuing the per-row update, or define an explicit safe-truncation policy for machine suggestions. Add focused Vitest coverage for C0 controls, overlong title suggestions, and one bad suggestion not rolling back unrelated valid rows unless that all-or-nothing behavior is intentional.

### C33-CODE-02 - Caption stub truncates by UTF-16 code units, which can split surrogate pairs

Severity: Low
Confidence: Medium

Exact citations:

- `apps/web/src/lib/caption-generator.ts:29-38`
- `apps/web/src/db/schema.ts:82-86`

Issue:

`generateCaptionStub()` limits generated suggestions with `raw.length <= ALT_TEXT_MAX_CHARS ? raw : raw.slice(0, ALT_TEXT_MAX_CHARS)`. JavaScript string length and `slice()` operate on UTF-16 code units, not Unicode code points. If a camera model contains supplementary characters near the 140-character boundary, this can split a surrogate pair and persist a malformed string into `alt_text_suggested`.

This is lower severity because the current stub is deterministic, short, and sourced from cleaned EXIF camera metadata. It is still inconsistent with the repo's broader Unicode handling, where field limits and validation usually reason in code points.

Concrete failure scenario:

1. EXIF `camera_model` contains an emoji or other supplementary-plane character at the truncation boundary.
2. The stub slices midway through the surrogate pair.
3. The persisted suggestion contains a lone surrogate, causing replacement-character rendering, mojibake, or driver/database encoding surprises in downstream alt text and bulk-copy flows.

Suggested fix:

Use a code-point-safe truncation helper, for example `Array.from(raw).slice(0, ALT_TEXT_MAX_CHARS).join('')`, or centralize truncation alongside the existing code-point counting helpers. Add a unit test with `139` ASCII characters plus an emoji to assert no lone surrogate is produced.

### C33-CODE-03 - Bulk image update rejects duplicated ID payloads before de-duplicating

Severity: Low
Confidence: High

Exact citations:

- `apps/web/src/app/actions/images.ts:997-1008`

Issue:

`bulkUpdateImages()` validates `ids.length > 100` before creating `requestedIds = [...new Set(ids)]`. A payload containing 101 entries but only one unique image ID is rejected as `tooManyImages`, even though the effective mutation scope is one row.

This is not currently a security issue, and the UI likely sends unique IDs. It is a brittle API edge case that can surface from client replay, stale selection state, or a future caller that appends selected IDs without de-duplicating first.

Concrete failure scenario:

1. The client sends a bulk-edit request with repeated selected IDs, such as 101 copies of the same image ID.
2. The server rejects the request before normalizing to the actual unique mutation set.
3. The user sees a misleading "too many images" failure even though the requested mutation would touch one row.

Suggested fix:

Normalize and validate numeric IDs first, de-duplicate second, then apply the 100-image cap to the unique ID set. If raw payload size needs its own anti-abuse cap, enforce it separately with a distinct error message.

## Positive Cross-File Checks

- Admin API route exports are covered by `withAdminAuth(...)`; the auth lint gate passed.
- Mutating server actions return early on `requireSameOriginAdmin()` or carry explicit exemptions; the action-origin lint gate passed.
- Public mutating/expensive routes are rate-limited or explicitly exempted; the public-route rate-limit lint gate passed.
- Public image select fields and privacy guards are centralized in `apps/web/src/lib/data.ts` and backed by the symmetric privacy test fixture.
- Upload, restore, image-processing, and backfill flows share maintenance/advisory lock boundaries; I did not find an unguarded restore/upload race in the inspected surfaces.
- Smart collection public pages check publication state at both metadata and render paths, and the query compiler validates depth, operators, fields, and budget before SQL generation.
- SQL restore scanning uses an app-table allowlist and blocks dangerous statements outside the allowed restore envelope.
- The Lightroom upload route has layered validation for auth, content length, extension/MIME, filename/topic/title input, disk budget, contract locking, and cleanup/maintenance restoration.

## Final Missed-Issues Sweep

Final sweeps covered:

- Raw SQL, restore scanner, migration/reconcile, and journal paths.
- Filesystem boundaries around upload, processing, delete, backup, restore, and generated public assets.
- Auth/session/token/env/proxy/rate-limit code paths.
- Public-route and server-action exemption scanners.
- Privacy-sensitive field selection and map/search/public listing surfaces.
- Caption/alt-text generation, fallback, bulk-copy, and tests.
- TODO/FIXME/HACK markers, catch/log paths, and pagination/cursor guards.

No additional confirmed critical or high-severity issues were found in that sweep. The primary fix I recommend for the next implementation lane is C33-CODE-01, with C33-CODE-02 and C33-CODE-03 as small hardening follow-ups.
