# Cycle 7 Code-Reviewer Review — API Routes / Server Actions / Lint-Gate Invariants

(Persisted by the orchestrator on the lane's behalf — the lane session had no Write tool.)

**Reviewed HEAD:** `14d31ea4` (matches the `.context/reviews/_aggregate.md` "Cycle 14" peer aggregate already in the repo)
**Scope:** `apps/web/src/app/api/**`, `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`, and the four lint-gate scripts (`check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, touch-target audit — not applicable here). Also traced the 7 named commits by inspecting their described surface areas directly (no `git show` available — no Bash tool in this session — so diffs were reconstructed from file content + in-repo commentary/plan artifacts referencing the same work packages: WP1 topic-deletion guard, WP3 abort-listener cleanup, WP4 `topK` partial-selection, WP5 analytics restore-tracking, WP6 map-truncation disclosure, WP7 sitemap/404-title, WP8/WP9 docs/gates).

## Summary

**No new high-confidence (≥80) findings.** Everything traced in this lane — every `/api/**` route handler, every mutating server action's `requireSameOriginAdmin()`/`isAdmin()` wiring, the `withAdminAuth` wrapper, and the three security lint-gate scanners — is internally consistent and matches the already-committed peer aggregate's positive evidence. Specifically hunted for the failure modes in the brief ("any handler that could slip past a gate," "any mutating action missing the same-origin early-return," "any public expensive GET without a rate limiter or exemption comment") and did not find one.

## Investigated and ruled out (no bug — recorded for audit trail)

### Candidate: `admin-mutation-barrier` exclusive flag could leak on restore drain-timeout

- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:540-610`, `apps/web/src/lib/admin-mutation-barrier.ts:94-135`
- Initially suspected that `drainAdminMutationsForRestore()` sets `state.exclusiveActive = true` (line 106 of `admin-mutation-barrier.ts`) and that the early `return { success: false, error: t('restoreFailed') }` at `db-actions.ts:574` (drain-timeout path) would skip `releaseAdminMutationExclusive()`, permanently wedging every mutating admin action until a process restart.
- **Verified false**: the early return at line 574 is nested inside the outer `try` block that starts at line 540, whose `finally` (line 585) unconditionally calls `releaseAdminMutationExclusive()`. Every early-return path inside that try (background-writes drain timeout, maintenance-sweep drain timeout, admin-mutation drain timeout, and the catch-all at line 576-579) still runs the `finally`. Confirmed correct.

No other candidate rose to reportable confidence.

## What was checked (evidence trail)

**Lint-gate scanners:**
- `apps/web/scripts/check-action-origin.ts` — full read. Verified the `trackedAnalyticsCallbackBody` extension (added for `trackAnalyticsDbWrite(...)` wrapping in `public.ts`) correctly requires an established rate-limit gate before treating mutations inside the callback as satisfied, and correctly falls back to scanning the callback body when no outer gate was seen. Traced against the actual `public.ts` call sites (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView`) — all three establish `checkViewRecordRateLimit(...)` and return early on `'rateLimited'` before the `trackAnalyticsDbWrite(...)` call, so the scanner's trust is justified by the real code.
- `apps/web/scripts/check-public-route-rate-limit.ts` — full read. Confirmed `EXPENSIVE_GET_MARKERS`/`EXPENSIVE_READ_IMPORT_MODULES` still cover `db.`, `ImageResponse`, `serveUploadFile`, `pickFirstAvailablePhotoBuffer`, `embedText`/`embedImage`, `getMapImages`, etc., and that `getMapImages()`'s new truncation return shape (`{images, truncated}`) doesn't change its call-site classification (invoked from a Server Component page, not an API route — consistent with the documented page-vs-route split for rate limiting).
- `apps/web/src/lib/api-auth.ts` (`withAdminAuth`) — full read. Token path and cookie/same-origin path both correctly fail closed; both admin API routes (`lr/upload`, `db/download`) are the only two `app/api/admin/**` route files and both use `withAdminAuth(...)` directly (verified via grep of every `export const GET|POST|...` under `app/api`).

**API routes (`app/api/**`):**
- `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` — same-origin check, restore-maintenance gate, content-type/length/chunked-encoding validation, then `preIncrementSemanticAttempt` before any DB-backed mode lookup, matching the documented "charge before disabled-mode lookup" rate-limit posture. No early-return path found that reaches DB/embedding work before the rate-limit pre-increment.
- `api/admin/lr/upload/route.ts` — fully re-read end-to-end (612 lines): tracker preclaim → multipart parse slot → validation → late restore re-check → upload-processing-contract lock → topic verify → disk-space check → save → HDR/GPS gates → late restore re-check → insert → post-commit bookkeeping, all wrapped in the outer `finally { uploadContractLock.release() }`. Every rejection branch calls `settleTrackerToActual(false)` before returning. No new gap found beyond the peer session's already-filed coverage-gap finding (VER-14-03, not re-filed here per the briefing's deferred-carry-forward rule).
- `api/admin/db/download/route.ts`, `api/health/route.ts`, `api/live/route.ts`, `api/og/**` — spot-checked against the documented contract; no discrepancy.

**Server actions (`app/actions/**`):**
- Grepped every `requireSameOriginAdmin`/`@action-origin-exempt` occurrence across `auth.ts`, `images.ts`, `settings.ts`, `seo.ts`, `collections.ts`, `topics.ts`, `admin-users.ts`, `embeddings.ts`, `tags.ts`, `sharing.ts`, `admin-backfill.ts`, `lr-tokens.ts`, `public.ts`. Every mutating export returns early on `requireSameOriginAdmin()` (or, for `public.ts`/`auth.ts`, uses the approved narrower public-rate-limit / `hasTrustedSameOrigin` shapes the scanner explicitly special-cases). No action found calling a DB write before its guard.
- `collections.ts` — read in full. All three mutating exports (`create/update/deleteSmartCollection`) follow the standard maintenance-check → origin-check → mutation-slot → `isAdmin()` → validate → mutate sequence.
- `topics.ts` `deleteTopic()` (new WP1 code) — the new smart-collection-reference scan runs inside the same `db.transaction` + `withTopicRouteMutationLock` as the existing image-reference check, so it shares the same TOCTOU protection. `queryReferencesTopicSlug`/`remapTopicSlugInQuery` in `lib/smart-collections.ts` only match `eq`/`in` predicates on the `topic` column (not `contains`/`between`) — a deliberate, pre-existing, documented asymmetry (CLAUDE.md) that the new deletion-guard code correctly mirrors rather than introduces; confidence this is a defect is low (<50).

**Other freshly-landed code traced for correctness:**
- `lib/clip-embeddings.ts` `topK()` (WP4 partial-selection rewrite) — traced the insertion-sort invariant by hand (winners list bounded at `k`, descending order maintained, ties preserved in original-array/insertion order matching prior stable full-sort behavior, input array never mutated). Correct.
- `lib/data.ts` `getMapImages()` + `app/[locale]/(public)/map/page.tsx` (WP6 truncation disclosure) — fetch-`+1`/slice/truncated-flag pattern is correct; i18n keys (`truncatedNotice`) present in both `en.json`/`ko.json`.
- `lib/serve-upload.ts` abort-listener cleanup (WP3) — named handler + removal on `close`/`end`/`error`, idempotent `destroy()`. Correct, no listener leak.
- `app/sitemap.ts` — `STATIC_PUBLIC_PATHS` now includes `/map`, `/privacy`, `/about-gallerykit`; the `reservedNonImageUrls` budget math uses `STATIC_PUBLIC_PATHS.length` consistently. Correct.
- `lib/admin-mutation-barrier.ts`, `lib/request-origin.ts`, `apps/web/src/db/index.ts`, `apps/web/src/proxy.ts` — read in full for the "mutation-lock cleanup" / "proxy + db timeout hardening" / "origin-check host preference" commits. All consistent with documented behavior; no logic bug found.

## Final sweep for commonly-missed issues

- Confirmed only two `app/api/admin/**` route files exist and both wrap `withAdminAuth`.
- Confirmed every `app/actions/*.ts` file's exported mutating functions have either the standard guard or an approved exemption shape (public.ts rate-limited actions, auth.ts's `hasTrustedSameOrigin` variant, read-only getters).
- Checked for `export *`/aliased/default exports in action and route files that could hide a handler from the scanners — none found.
- Checked the touch-target gate is not implicated by any of the 7 commits' surface area (no new interactive elements beyond the settings bottom-Save button, which reuses the existing `min-h-11` class).
- No new `/api/**` or action-layer regression from the dependency-bump commit (WP2, `next`/`postcss` patch bumps).
- Did not re-file already-deferred findings from `deferred-carry-forward.md` or the cycle-6/cycle-7 deferred registers.

**Files reviewed (for traceability):** `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/proxy.ts`, `apps/web/src/db/index.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/data.ts` (map section), `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts` (restore path), `apps/web/src/components/not-found-document-title.tsx`, `apps/web/src/app/[locale]/not-found.tsx`.
