# Cycle 7 Ultradeep Verifier Review

Scope: full repository pass, with a final missed-issues sweep after inspecting the core app/actions/data/storage surfaces and validating the repo with unit tests and lint.

## Confirmed Issues

### V7-01 — Duplicate tag query params can zero out a valid gallery filter
**Confidence:** High

**Files / regions:**
- `apps/web/src/lib/tag-slugs.ts:3-10`
- `apps/web/src/lib/data.ts:277-289`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:22-46, 69-91`

**Why this is a problem:**
`parseRequestedTagSlugs()` preserves duplicates, and `buildTagFilterCondition()` requires `COUNT(DISTINCT tags.slug) = validTagSlugs.length`. If the request contains the same slug twice, the HAVING clause asks for two distinct slugs even though only one exists, so the query returns no images.

**Concrete failure scenario:**
A user opens or shares a URL like `?tags=landscape,landscape` (or a client emits the same tag twice). The topic page and the `getImageCount()`/`getImagesLite()` queries can report zero results even though matching photos exist.

**Suggested fix:**
Deduplicate requested tag slugs before building the filter condition, and use the deduped set size in the HAVING clause. The same normalization should be applied wherever requested tag slugs are consumed for display or metadata.

---

### V7-02 — Batch tag updates silently drop malformed tag names
**Confidence:** High

**File / region:**
- `apps/web/src/app/actions/tags.ts:347-400`

**Why this is a problem:**
In `batchUpdateImageTags()`, malformed names are handled with `continue` in both the add and remove loops. That means a control-character-containing tag name is discarded without surfacing an error or warning. The action can return success even when part of the user’s requested work was ignored.

**Concrete failure scenario:**
An admin pastes a comma-separated list that contains an invisible tab/newline inside one tag name. The batch save completes, but that tag is silently skipped. The UI reports success and the operator may not realize the requested change was only partially applied.

**Suggested fix:**
Either fail the batch when any malformed tag name is encountered, or accumulate explicit warnings for every skipped item so the UI can report partial application clearly.

---

## Likely Issues

### V7-03 — Sanitized settings/SEO values leave the admin forms stale after save
**Confidence:** Medium

**Files / regions:**
- `apps/web/src/app/actions/settings.ts:51-78`
- `apps/web/src/app/actions/seo.ts:64-103`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:33-56`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-53`

**Why this is a problem:**
Both server actions strip control characters and normalize values before persisting them, but the client forms keep their local state as-if the original input was stored. `SettingsClient` writes `initialRef.current = nextSettings`, and `SeoSettingsClient` writes `initialRef.current = { ...settings }`, so the saved server value and the form baseline can diverge whenever the server sanitizes or normalizes input.

**Concrete failure scenario:**
An admin pastes a title or configuration value containing a hidden control character. The save succeeds, but the field remains displayed in its unsanitized form in the UI, and future “no changes” checks compare against the stale local copy rather than the canonical value in the database.

**Suggested fix:**
Return canonical saved values from the actions and replace the client state with those values, or re-fetch the updated settings after a successful save so the form baseline always matches persisted data.

---

## Risks Requiring Manual Validation

- `apps/web/src/app/actions/admin-users.ts:77-119`, `apps/web/src/app/actions/sharing.ts:49-114, 141-214` increment rate-limit counters before validation completes. I did not prove whether consuming quota on malformed admin submissions is intentional or acceptable UX, so this remains a manual-validation risk rather than a confirmed issue.

## Notes

- Repo validation run: `npm test --workspace=apps/web` passed (115/115 tests).
- Repo validation run: `npm run lint --workspace=apps/web` passed.
