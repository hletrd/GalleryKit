# Cycle 10 Test Coverage Review

## Inventory

### Coverage-relevant docs/config reviewed
- `README.md`
- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/helpers.ts`

### Existing automated coverage reviewed
- Unit/Vitest: `apps/web/src/__tests__/*.test.ts` (23 files, 137 tests)
- E2E/Playwright: `apps/web/e2e/admin.spec.ts`, `nav-visual-check.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`

### High-risk code surfaces inspected
- Server actions: `apps/web/src/app/actions/{images,topics,tags,sharing,settings,seo,admin-users,auth,public}.ts`
- Data/utilities: `apps/web/src/lib/{data,upload-paths,storage/index,storage/local,process-image,image-queue,rate-limit,auth-rate-limit}.ts`
- UI behavior: `apps/web/src/components/{search,lightbox,photo-navigation,info-bottom-sheet,nav-client,upload-dropzone,image-manager}.tsx`

### Verification snapshot
- `npm test --workspace=apps/web` → 23 files passed, 137 tests passed
- `cd apps/web && npx playwright test --list` → 14 E2E tests defined

---

## Findings

### Confirmed issues

1. **Share-link creation has no regression coverage for rate-limit rollback or key-collision retry paths**  
   - **Code:** `apps/web/src/app/actions/sharing.ts:62-152`, `154-262`  
   - **Why this is confirmed:** no unit/integration test targets `createPhotoShareLink` or `createGroupShareLink`; current suite never exercises the in-memory pre-increment rollback, duplicate-key retry loop, or “existing key already present” fast path.  
   - **Failure scenario:** a DB bucket that reports the request over-limit after the in-memory pre-increment can leave the in-memory counter inflated, causing premature throttling for the rest of the window; duplicate `ER_DUP_ENTRY` collisions can also regress into hard failures instead of retries.  
   - **Right test type:** integration-style Vitest with mocked `db`, `headers`, `rate-limit`, and `generateBase56`.  
   - **Confidence:** High.

2. **Admin-user management lacks tests for legitimate-attempt rollback and last-admin deletion protection**  
   - **Code:** `apps/web/src/app/actions/admin-users.ts:68-159`, `162-239`  
   - **Why this is confirmed:** there is no test coverage for `createAdminUser` or `deleteAdminUser`; the current unit suite never touches the advisory lock / transaction flow.  
   - **Failure scenario:** a successful user creation or infra-only failure can leave rate-limit state uncleared and block later real admin actions; concurrent delete flows can regress the “cannot delete last admin” guarantee or return the wrong error when the advisory lock times out.  
   - **Right test type:** integration-style Vitest around mocked DB/connection objects; one test for create-rate-limit reset, one for delete lock/last-admin branches.  
   - **Confidence:** High.

3. **Gallery-settings persistence is untested where derivative-size locking matters most**  
   - **Code:** `apps/web/src/app/actions/settings.ts:36-128`  
   - **Why this is confirmed:** no tests cover `updateGallerySettings`; current coverage stops at `gallery-config-shared` helpers and never verifies the action’s DB-dependent lock behavior.  
   - **Failure scenario:** once processed images exist, a regression could silently allow `image_sizes` changes, orphaning expected derivatives and breaking image URL generation/cache assumptions; empty values could also stop deleting settings rows and leave stale overrides in place.  
   - **Right test type:** integration-style Vitest with mocked `adminSettings`, `images`, and transaction behavior.  
   - **Confidence:** High.

4. **SEO-settings action lacks regression coverage for key validation, URL validation, and empty-value deletion**  
   - **Code:** `apps/web/src/app/actions/seo.ts:50-134`  
   - **Why this is confirmed:** there are no tests for `updateSeoSettings`; current suite does not exercise any SEO action behavior.  
   - **Failure scenario:** invalid keys or non-http(s) OG URLs can slip through after future refactors, or empty fields can stop deleting stored overrides, leaving stale SEO metadata in production.  
   - **Right test type:** unit/integration Vitest with mocked translations and transaction calls.  
   - **Confidence:** High.

5. **Topic and alias actions have no tests for slug-cascade behavior or image cleanup on failure**  
   - **Code:** `apps/web/src/app/actions/topics.ts:34-105`, `107-229`, `232-390`  
   - **Why this is confirmed:** no tests reference `createTopic`, `updateTopic`, `deleteTopic`, `createTopicAlias`, or `deleteTopicAlias`.  
   - **Failure scenario:** renaming a topic can regress the multi-table cascade (`images.topic`, `topicAliases.topicSlug`, `topics.slug`) and leave broken routes/search results; duplicate/failed topic-image updates can also leak a newly processed header image instead of cleaning it up.  
   - **Right test type:** integration-style Vitest with mocked transaction steps and `processTopicImage` / `deleteTopicImage`.  
   - **Confidence:** High.

6. **Image actions are only covered indirectly; the critical upload/delete flows themselves are not locked**  
   - **Code:** `apps/web/src/app/actions/images.ts:81-210`, `348-617`  
   - **Why this is confirmed:** existing tests hit helper modules (`upload-tracker`, `serve-upload`) but not `uploadImages`, `deleteImage`, `deleteImages`, or `updateImageMetadata`.  
   - **Failure scenario:** cumulative quota enforcement, restore-maintenance cleanup, privacy-safe GPS stripping, or partial delete cleanup/revalidation can regress without any failing test; metadata sanitization could also drift from what the UI expects.  
   - **Right test type:** integration-style Vitest for action logic plus one E2E for a real multi-file upload/delete happy path.  
   - **Confidence:** High.

7. **Buffered shared-group view counting has no coverage for outage backoff or partial-flush recovery**  
   - **Code:** `apps/web/src/lib/data.ts:10-107`  
   - **Why this is confirmed:** nothing in the current suite references `flushBufferedSharedGroupViewCounts`, the buffer, or the exponential backoff path.  
   - **Failure scenario:** a refactor can drop buffered increments, fail to re-buffer failed writes, or hammer the database every 5 seconds during outages instead of backing off.  
   - **Right test type:** unit Vitest with fake timers and a mocked `db.update`.  
   - **Confidence:** High.

8. **Upload-path and storage-backend safety contracts are currently untested**  
   - **Code:** `apps/web/src/lib/upload-paths.ts:48-94`, `apps/web/src/lib/storage/index.ts:53-179`, `apps/web/src/lib/storage/local.ts:25-118`  
   - **Why this is confirmed:** no test covers legacy-original fallback, production fail-closed behavior, storage-backend rollback, or local path traversal blocking.  
   - **Failure scenario:** a failed backend switch can leave the singleton in a broken state, local storage can regress path-traversal blocking, or production can stop failing closed when legacy public originals still exist.  
   - **Right test type:** unit Vitest with temporary directories and mocked backend init/dispose failures.  
   - **Confidence:** High.

### Likely issues

9. **Search overlay behavior is only partially covered; keyboard/race regressions can slip through**  
   - **Code:** `apps/web/src/components/search.tsx:40-123`, `170-245`; current E2E only in `apps/web/e2e/public.spec.ts:21-59`  
   - **Why this is likely:** the E2E suite covers open/focus/close and one content match, but does not assert stale-request suppression, arrow-key selection, Enter navigation, Cmd/Ctrl+K toggling, or body-scroll restoration.  
   - **Failure scenario:** a slower earlier search response can overwrite a newer query’s results, keyboard navigation can break silently, or closing the dialog can leave background scrolling locked on mobile.  
   - **Right test type:** component/unit tests for request-id race handling plus one E2E for keyboard selection/navigation.  
   - **Confidence:** Medium.

10. **Mobile viewer interactions remain under-locked despite recent smoke coverage**  
   - **Code:** `apps/web/src/components/lightbox.tsx:51-186`, `apps/web/src/components/photo-navigation.tsx:42-139`, `apps/web/src/components/info-bottom-sheet.tsx:31-115`; current E2E only in `apps/web/e2e/public.spec.ts:61-97` and `apps/web/e2e/test-fixes.spec.ts:44-54`  
   - **Why this is likely:** current E2E proves that the lightbox and info sheet can open, but not that swipe thresholds, fullscreen/Escape semantics, focus restoration, or sheet collapse/close gestures keep working.  
   - **Failure scenario:** a mobile swipe starts navigating vertically scrolling pages, Escape closes the wrong layer, or the bottom sheet gets stuck between `peek/collapsed/expanded` states with no regression signal.  
   - **Right test type:** component tests for gesture state transitions plus one mobile E2E for swipe navigation/collapse behavior.  
   - **Confidence:** Medium.

### Manual-validation risks / flaky-test risks

11. **The visual-nav spec is not actually asserting anything visual**  
   - **Code:** `apps/web/e2e/nav-visual-check.spec.ts:4-33`  
   - **Why this is a risk:** the tests only write PNG files to `test-results/`; they do not use `toHaveScreenshot`, image diffing, or a baseline comparison.  
   - **Failure scenario:** the suite stays green even when the nav layout, spacing, or control visibility regresses badly, because screenshot generation itself is the only “assertion.”  
   - **Right test type:** E2E screenshot assertions with committed baselines (or move these to an explicitly manual review workflow).  
   - **Confidence:** High.

12. **Admin E2E coverage is opt-in, so the default green path misses the entire protected surface**  
   - **Code:** `apps/web/e2e/admin.spec.ts:6-55`, `apps/web/e2e/helpers.ts:18-53`  
   - **Why this is a risk:** the whole describe block is skipped unless `E2E_ADMIN_ENABLED=true`, and remote admin runs are blocked unless additional env flags are set. The default `test:e2e` path therefore does not exercise admin login, navigation, upload, or DB tooling.  
   - **Failure scenario:** an admin-only regression ships while local/public E2E remains green because the protected flows were never executed in CI or routine local runs.  
   - **Right test type:** keep destructive admin flows opt-in if needed, but add at least one always-on seeded admin smoke test for login + dashboard reachability.  
   - **Confidence:** High.

---

## Final missed-issues sweep
- Re-cross-checked exported server actions and lib entry points against the current Vitest and Playwright suites.
- Re-reviewed the major untested branches with the highest regression cost: sharing, admin-users, topics, image actions, settings/SEO, buffered counters, and storage/upload safety.
- I did **not** find evidence that the existing suite locks these behaviors today; the gaps above remain the highest-value additions from the repo-wide coverage angle.

## Finding count
- **12 findings total**
  - **8 confirmed issues**
  - **2 likely issues**
  - **2 manual-validation/flaky-test risks**
