# Quality Review — Cycle 3 / Prompt 1

Reviewer: quality-reviewer additional pass  
Date: 2026-04-29  
Scope: whole repository, read-only implementation review. No implementation files were edited.

## Inventory and coverage

I inventoried relevant tracked and workspace files first, excluding generated/vendor/runtime artifacts (`.git`, `node_modules`, `.next`, `.omx`, `.omc`, `.context`, coverage/playwright/test-result output). The review covered all 348 relevant source/config/test/docs/database files identified by that inventory, not a sample:

- `apps/web/src/**`: 231 files, including application routes, server actions, components, DB/data libraries, storage/image-processing/auth/SEO/i18n utilities, and 72 unit/contract tests.
- `apps/web/e2e/**`: 6 Playwright specs/helpers.
- `apps/web/drizzle/**`: 7 schema migration/meta files.
- `apps/web/messages/*.json`: 2 locale catalogs.
- `apps/web/scripts/**`: 16 operational/migration/seed/check scripts.
- App/root config and static assets: 19 app-level config/static files plus 8 root docs/config files.
- `.github/**`: 2 CI/dependency automation files.

Additional consistency checks performed during the pass:

- Locale parity: `en.json` and `ko.json` both contain 509 scalar keys; no missing keys in either direction.
- Static sweeps for review hotspots: MySQL error helpers, tag filtering/canonicalization, stale-query guards, `dangerouslySetInnerHTML`, TypeScript suppressions/casts, broad catches, TODO/FIXME/HACK markers, and raw SQL usage.
- Final missed-issues sweep rechecked the main finding patterns and did not surface additional reportable issues above the confidence threshold.

## Findings

### Q3-QR-01 — Wrapped MySQL errors with only `cause.code` are not recognized

Severity: Medium  
Confidence: High

Files/regions:

- `apps/web/src/lib/validation.ts:109-116` — `isMySQLError` requires a top-level string `.code`; `hasMySQLErrorCode` then claims to check a "top-level or wrapped" code, but wrapped cause-only errors fail the guard before `cause` is inspected.
- `apps/web/src/__tests__/validation.test.ts:244-259` — tests cover a top-level code and a wrapped error that still has a top-level code, but not a wrapper whose only MySQL code is on `cause`.
- User-visible call sites depend on this helper or repeat the same guard shape: `apps/web/src/app/actions/admin-users.ts:162-174`, `apps/web/src/app/actions/sharing.ts:172-182`, `apps/web/src/app/actions/sharing.ts:284-302`, `apps/web/src/app/actions/topics.ts:150-158`, `apps/web/src/app/actions/topics.ts:294-308`, `apps/web/src/app/actions/topics.ts:427-435`.

Failure scenario:

If Drizzle/mysql2 or another wrapper throws `new Error('wrapped', { cause })` where only `cause.code` is `ER_DUP_ENTRY` or `ER_NO_REFERENCED_ROW_2`, duplicate admin username creation returns the generic `failedToCreateUser` path instead of `usernameExists`; share-key collisions stop retrying and can fail a valid share action; topic duplicate/FK races return generic errors instead of the intended duplicate/not-found messages and rollback behavior.

Concrete fix:

Replace the type guard with a code extractor that does not require top-level `.code`, and use it everywhere duplicate/FK decisions are made. For example, add `getMySQLErrorCode(e: unknown): string | null` that checks top-level `code`, then `cause.code` (recursively or at least one level), and implement `hasMySQLErrorCode` from that extractor. Update the topic actions to use the shared helper instead of repeating `isMySQLError(e) && (e.code || e.cause?.code)`. Add a regression test for `Object.assign(new Error('wrapped'), { cause: { code: 'ER_DUP_ENTRY' } })` or an equivalent `Error` with a cause-only code.

### Q3-QR-02 — Invalid or unknown `?tags=` values collapse to unfiltered gallery content

Severity: Medium  
Confidence: High

Files/regions:

- `apps/web/src/lib/tag-slugs.ts:6-15` — overlong tag query strings return `[]`; otherwise raw comma segments are canonicalized but format/unknown-tag failures are not represented separately.
- `apps/web/src/lib/tag-slugs.ts:37-48` — unknown requested tags are silently dropped.
- `apps/web/src/app/[locale]/(public)/page.tsx:18-45`, `apps/web/src/app/[locale]/(public)/page.tsx:78-82`, `apps/web/src/app/[locale]/(public)/page.tsx:135-140` — metadata and page queries treat "requested tags were present but none survived" the same as "no tag filter".
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:41-66`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:99-107`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:162-166` — topic pages have the same collapse-to-unfiltered behavior.
- `apps/web/src/app/actions/public.ts:80-97` — load-more sanitizes caller tag arrays to `safeTags`; an all-invalid array becomes `[]`, which fetches unfiltered rows.
- `apps/web/src/components/tag-filter.tsx:14-39`, `apps/web/src/components/tag-filter.tsx:65-103` — the client derives pressed state from the raw URL parameter, so an unknown tag makes "All" unpressed while no real tag is pressed, even though server content is unfiltered.

Failure scenario:

A request such as `/en/?tags=does-not-exist`, `/en/?tags=%00`, or `/en/travel?tags=missing-tag` renders the normal unfiltered gallery under a filtered-looking URL. Metadata/canonical output treats the page like the unfiltered page, `robots` is not set to `noindex`, and infinite scroll can continue appending unfiltered images while the UI implies a filtered state. This creates duplicate URLs for the same content and a confusing filter state for users and crawlers.

Concrete fix:

Make tag parsing/filtering preserve intent, e.g. return `{ requested, valid, invalid }` or a `hadTagParam` flag. When `tags` is present but no valid existing tags remain, choose one canonical behavior: redirect to the URL without `tags`, render a 404/empty noindex filter state, or show an explicit invalid-filter message. Pass server-normalized `currentTags` to the client filter (or canonicalize against the available tags client-side) so UI pressed state matches server data. For `loadMoreImages`, return `status: 'invalid'` when a non-empty supplied tag array sanitizes to empty, and consider checking existence for valid-format but unknown tag slugs.

### Q3-QR-03 — `HomeClient` has a dead stale-query guard that documents behavior it does not enforce

Severity: Low  
Confidence: High

Files/regions:

- `apps/web/src/components/home-client.tsx:105-119` — `queryVersionRef` is created and incremented, and the comment says stale in-flight load-more responses are discarded, but `queryVersionRef.current` is never read in this component.
- `apps/web/src/components/load-more.tsx:30-39`, `apps/web/src/components/load-more.tsx:67-87` — the real stale-response cancellation lives inside `LoadMore`, not in `HomeClient`.
- `apps/web/src/components/home-client.tsx:274-282` — `HomeClient` only passes `onLoadMore`; it does not pass or validate any version token before appending rows.

Failure scenario:

The current runtime path is protected by `LoadMore`, but the parent component's stale-guard comment is misleading. A future maintainer could move append behavior, add another async load path, or refactor `LoadMore` assuming `HomeClient` already owns stale-response protection. The dead ref also adds noise around a sensitive infinite-scroll state transition.

Concrete fix:

Delete `HomeClient`'s unused `queryVersionRef` and replace the comment with a precise one such as "Reset allImages when the images prop changes; LoadMore owns stale-response cancellation." If parent-level protection is desired, pass a query key/version into `handleLoadMore` and verify it before appending.

### Q3-QR-04 — `/api/og` charges rate-limit budget before honoring cache revalidation

Severity: Low  
Confidence: Medium

Files/regions:

- `apps/web/src/app/api/og/route.tsx:39-55` — `preIncrementOgAttempt` runs before topic/SEO lookup and before ETag computation.
- `apps/web/src/app/api/og/route.tsx:72-87` — matching `If-None-Match` requests correctly return `304`, but only after consuming the per-IP OG rate-limit slot.

Failure scenario:

Browsers, crawlers, or social unfurlers that repeatedly revalidate a cached OG image with `If-None-Match` can exhaust the same 30-request/minute budget used to protect actual image rendering. A burst of harmless 304 validations may cause later uncached OG image requests from the same client/IP to receive 429, even though the expensive SVG/PNG pipeline was skipped.

Concrete fix:

For valid topic inputs, fetch the cheap metadata needed to compute the ETag and return `304` before incrementing the render rate limit. Keep `preIncrementOgAttempt` on the actual image-render path. If the DB lookup itself needs protection, add a separate cheaper request cap or apply a lower-cost limiter that distinguishes cache hits from renders.

## Final missed-issues sweep

The final sweep re-ran targeted searches for the reported concern families (`hasMySQLErrorCode`, `isMySQLError`, tag parsing/filtering, `queryVersionRef`, OG ETag/rate-limit ordering) plus broader quality hotspots (`dangerouslySetInnerHTML`, TypeScript suppressions/casts, broad `catch`, TODO/FIXME/HACK, raw SQL). The remaining hits were either expected safe patterns already covered by tests/contracts, test-only casts, or implementation-specific error-handling paths without a clear defect at this review threshold. No additional findings were added.
