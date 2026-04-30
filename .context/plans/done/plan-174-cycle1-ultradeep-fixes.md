# Plan 174 — Cycle 1 Ultradeep Fixes

**Created:** 2026-04-22
**Status:** DONE
**Purpose:** Implement the highest-signal, cycle-1 ultradeep review findings that are code-fixable within this cycle while honoring the injected deploy-config request.

## Scheduled Fixes

### C174-01: Bound account-scoped login rate-limit keys to a collision-resistant fixed length
**Severity:** HIGH | **Confidence:** High
**Sources:** `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/architect.md`
**Files:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/__tests__/rate-limit.test.ts`

The new `login_account` bucket currently persists `acct:${username}` into `rate_limit_buckets.ip`, which is only `varchar(45)`. Valid long usernames can overflow/truncate the bucket key and silently degrade to IP-only protection.

Implementation:
1. Add a helper that derives a fixed-length account bucket key (for example, `acct:` + truncated SHA-256 digest) so it always fits the existing schema.
2. Replace direct `acct:${normalizedUsername}` usage in `login()` with the bounded key helper.
3. Add regression coverage proving long-but-valid usernames still produce a stable <=45-char bucket key and distinct usernames produce distinct keys.

### C174-02: Make batch image deletion report real outcomes and keep audit rows bounded
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `.context/reviews/code-reviewer.md`
**Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/audit.ts` (if needed), `apps/web/src/__tests__/upload-tracker.test.ts` or new targeted unit coverage if extraction is needed

`deleteImages()` currently returns `count = foundIds.length` even when concurrent deletes removed 0 rows, and it logs a comma-joined `target_id` that can overflow the audit schema.

Implementation:
1. Capture `affectedRows` from the batch delete transaction and derive the returned `count/errors` from the real delete result.
2. Move batch-delete audit detail into `metadata` and keep `targetId` short and schema-safe.
3. Ensure audit logging happens after the delete outcome is known.
4. Add targeted regression coverage for any extracted helper(s) used to compute the bounded audit payload or deletion summary.

### C174-03: Fail stale topic/tag mutations instead of returning false success, and clean up orphaned topic images
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `.context/reviews/code-reviewer.md`
**Files:** `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`

`updateTopic()`, `deleteTopic()`, and `deleteTag()` can currently return success even when the target row no longer exists. `updateTopic()` can also leave a newly processed header image orphaned when the final update affects 0 rows.

Implementation:
1. Check `affectedRows` for topic/tag update/delete mutations.
2. Return `topicNotFound` / `tagNotFound` (or equivalent stale-data errors) when the target row vanished.
3. Ensure a freshly processed topic image is deleted if the update never lands.

### C174-04: Enforce the private-originals boundary outside migration-only assumptions
**Severity:** HIGH | **Confidence:** High
**Sources:** `.context/reviews/security-reviewer.md`, `.context/reviews/critic.md`
**Files:** `apps/web/scripts/seed-e2e.ts`, `apps/web/e2e/admin.spec.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/nginx/default.conf`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `README.md`, `CLAUDE.md`

The repo still has a legacy public-originals path and test tooling that writes originals into `public/uploads/original`, which undermines the documented privacy model. The UI setting also overstates GPS stripping by implying the source file EXIF is rewritten.

Implementation:
1. Move Playwright/upload fixture sourcing away from `public/uploads/original` into a dedicated test-fixture path.
2. Make `seed-e2e.ts` write original files into the private original-upload root instead of the public web root.
3. Add a startup/runtime guard that fails loudly in production when legacy public originals remain.
4. Add an nginx deny rule for `/uploads/original/`.
5. Reword the GPS privacy setting/docs to describe the real behavior (do not claim source-file EXIF rewriting if only persisted metadata is stripped).

### C174-05: Add a repo-native deploy helper that sources root `.env.deploy`
**Severity:** MEDIUM | **Confidence:** High
**Sources:** user-injected TODOs, `.env.deploy`, `apps/web/deploy.sh`
**Files:** `.gitignore`, `.env.deploy.example`, `scripts/deploy-remote.sh`, `package.json`, `README.md`

The user explicitly requested deploy config live in a gitignored env file and asked the agent to stop asking again. Add a tracked example + helper so future runs can discover and execute the deployment command from `.env.deploy` without prompting.

Implementation:
1. Keep root `.env.deploy` gitignored and document its schema in a tracked `.env.deploy.example`.
2. Add a small repo-level deploy helper script that sources `.env.deploy` and runs `DEPLOY_CMD`.
3. Add a root `npm run deploy` convenience script and README documentation.

### C174-06: Preserve shared-group context during photo prev/next navigation
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `.context/reviews/debugger.md`
**Files:** `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`

Shared-group photo navigation currently hardcodes `/p/<id>` for prev/next/swap navigation, which drops the visitor out of `/g/<key>?photoId=...` and loses the shared context.

Implementation:
1. Thread a route-builder or shared-view base-path through `PhotoViewer` and `PhotoNavigation`.
2. Keep `/p/<id>` for public single-photo routes, but preserve `/g/<key>?photoId=<id>` in shared-group mode.
3. Verify the fix against both click and swipe navigation paths.

## Progress
- [x] C174-01: Bounded account-scoped login rate-limit keys
- [x] C174-02: Accurate batch delete outcome + bounded audit payload
- [x] C174-03: Stale topic/tag mutation guards + orphan topic-image cleanup
- [x] C174-04: Private-original boundary hardening + truthful GPS wording
- [x] C174-05: Root `.env.deploy` helper and tracked example/docs
- [x] C174-06: Shared-group prev/next route preservation
