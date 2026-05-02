# Aggregate Review — Cycle 2 (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c2-code-reviewer.md`) — 8 findings
2. **security-reviewer** (`c2-security-reviewer.md`) — 7 findings
3. **perf-reviewer** (`c2-perf-reviewer.md`) — 6 findings
4. **architect** (`c2-architect.md`) — 5 findings
5. **debugger** (`c2-debugger.md`) — 6 findings
6. **test-engineer** (`c2-test-engineer.md`) — 6 findings
7. **critic** (`c2-critic.md`) — 5 findings
8. **designer** (`c2-designer.md`) — 3 findings
9. **verifier** (`c2-verifier.md`) — 6 findings (3 cycle-1 verifications + 3 new)

## AGENT FAILURES

None — all review angles covered.

---

## Cycle 1 fix verification

- **C1F-CR-04 (rate-limit rollback removal)**: VERIFIED correct in `auth.ts:243-254`
- **C1F-DB-02 (permanentlyFailedIds tracking)**: VERIFIED correct in `image-queue.ts:336-345, 436-438`, BUT missing cleanup on image deletion (see A2-HIGH-01)
- **C1F-CR-08 (sanitizeAdminString returns null on rejected)**: VERIFIED correct in `sanitize.ts:156-158`

## Dismissed findings (verified as non-issues)

- **C2-CR-07** (search LIKE wildcard escaping): `searchTerm` is built from the already-escaped `query` variable at line 967-968. All three LIKE queries use the same properly-escaped value. NOT an issue.
- **C2-SR-03** (session token future timestamp): `tokenAge < 0` correctly catches all future timestamps. NOT an issue.
- **C2-SR-06** (topic slug search reveals existence): Topic slugs are already public in URLs. NOT an issue.
- **C2-SR-07 / C2-DB-06** (admin user creation password length ordering): `stripControlChars` is applied BEFORE the length check at line 90-104. The ordering is correct. NOT an issue.
- **C2-CR-04** (getImage NULL capture_date navigation): Navigation is correct for the DESC sort order. NOT an issue.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### HIGH severity (confirmed by multiple agents)

#### A2-HIGH-01: `permanentlyFailedIds` not cleaned on image deletion — silent bootstrap exclusion
- **Sources**: C2-CR-01, C2-CR-02, C2-SR-01, C2-DB-01, C2-CT-01, C2-TE-01, C2-VF-01
- **7 agents agree** — highest signal finding this cycle
- **Location**: `apps/web/src/app/actions/images.ts:482-483` (single delete), `584-588` (batch delete)
- **Issue**: When images are deleted, their IDs are removed from `queueState.enqueued` but NOT from `queueState.permanentlyFailedIds`. After a DB restore, the auto-increment counter may reuse those IDs for new images, which would then be silently excluded from bootstrap scanning. The FIFO eviction cap (1000) limits but does not prevent this.
- **Fix**: Add `queueState.permanentlyFailedIds.delete(id)` in both `deleteImage()` and `deleteImages()`.

### MEDIUM severity

#### A2-MED-01: `normalizeStringRecord` bypasses Unicode formatting rejection policy
- **Sources**: C2-CR-08, C2-SR-02, C2-AR-01, C2-CT-02, C2-TE-02, C2-VF-02
- **6 agents agree**
- **Location**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: `normalizeStringRecord` uses `stripControlChars` (which removes bidi/formatting chars) but does NOT return a `rejected` flag like `sanitizeAdminString`. Admin SEO settings are the primary affected surface. This creates a gap in the C7R-RPL-11 / C3L-SEC-01 defense-in-depth chain.
- **Fix**: Add a `rejected` field to `normalizeStringRecord`'s return type, matching `sanitizeAdminString`. Update callers in `actions/settings.ts` to check the `rejected` flag.

#### A2-MED-02: `loadMoreImages` re-throws error without client-side error handling
- **Sources**: C2-CR-06, C2-DB-03, C2-CT-05, C2-UX-01
- **4 agents agree**
- **Location**: `apps/web/src/app/actions/public.ts:105-108`, `apps/web/src/components/load-more.tsx`
- **Issue**: When `getImagesLite` throws, the server action re-throws. The client-side `load-more.tsx` may not handle this gracefully, leaving the "Load More" button in a broken state.
- **Fix**: Wrap the client-side server action call in a try/catch with a toast error on failure.

#### A2-MED-03: `getAdminImagesLite` selects all admin fields including EXIF for listing — wasteful
- **Sources**: C2-PR-06, C2-AR-04
- **2 agents agree**
- **Location**: `apps/web/src/lib/data.ts:639-661`
- **Issue**: The admin listing query fetches all `adminSelectFields` including 12+ EXIF columns, but the admin dashboard grid only needs a small subset. This wastes DB bandwidth and InnoDB buffer pool pressure.
- **Fix**: Create a `adminListSelectFields` that omits EXIF and other non-display columns for listing queries.

#### A2-MED-04: Rate-limit pattern inconsistency across codebase — no documentation
- **Sources**: C2-AR-03, C2-CT-04
- **2 agents agree**
- **Location**: Multiple files (`auth.ts`, `public.ts`, `sharing.ts`, `admin-users.ts`)
- **Issue**: Three distinct rate-limit rollback patterns exist (no-rollback-on-infra-error, rollback-on-infra-error, rollback-on-limit-only) with no centralized documentation explaining when to use each.
- **Fix**: Add a doc comment block in `lib/rate-limit.ts` explaining the three patterns and when to use each.

#### A2-MED-05: `getImage` UNION prev/next optimization deferred from cycle 1
- **Sources**: C2-PR-04 (re-confirmation of A1-MED-01)
- **Location**: `apps/web/src/lib/data.ts:735-767`
- **Issue**: Each photo view runs 3 parallel DB queries. The UNION optimization planned in plan-336 was deferred. Re-confirming the need.
- **Fix**: Implement the UNION query as planned in plan-336.

#### A2-MED-06: `restoreDatabase` temp file predictability (carried from cycle 1)
- **Sources**: C2-CR-05, C2-SR-04 (re-confirmation of A1-LOW-05)
- **Location**: `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Issue**: Temp file name is partially predictable. In Docker environments with shared `/tmp`, an attacker could pre-create a symlink.
- **Fix**: Use `crypto.randomUUID()` for the temp file name and `O_CREAT | O_EXCL` for atomic creation.

#### A2-MED-07: View count buffer cap enforcement test coverage gap
- **Sources**: C2-TE-05
- **Location**: `apps/web/src/__tests__/data-view-count-flush.test.ts`
- **Issue**: The post-rebuffer cap enforcement test only covers the basic case. No test for the interaction between FIFO eviction and the retry counter.
- **Fix**: Add a comprehensive test covering buffer-at-capacity + flush-failure + re-buffer + retry counter interaction.

### LOW severity

#### A2-LOW-01: `permanentlyFailedIds` lost on process restart
- **Sources**: C2-AR-05
- **Location**: `apps/web/src/lib/image-queue.ts:116`
- **Issue**: The set is in-memory only and lost on restart, causing 3 retry attempts per restart for permanently-failed images.
- **Fix**: Consider persisting to DB. Low priority given bounded nature.

#### A2-LOW-02: `searchImages` LIKE-based queries without FULLTEXT indexes
- **Sources**: C2-PR-02
- **Location**: `apps/web/src/lib/data.ts:961-1074`
- **Issue**: LIKE-based search is acceptable at personal-gallery scale but will degrade with growth.
- **Fix**: Consider FULLTEXT indexes when image count exceeds 10K.

#### A2-LOW-03: Lightbox controls may flash on fast navigation
- **Sources**: C2-UX-02
- **Location**: `apps/web/src/components/lightbox.tsx:94-118`
- **Issue**: Controls may briefly flash between image navigations.
- **Fix**: Consider adding a `key` prop for clean re-mounting.

#### A2-LOW-04: Photo viewer loading skeleton could be more informative
- **Sources**: C2-UX-03
- **Location**: `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- **Issue**: No progress indication for slow connections.
- **Fix**: Low priority. Consider pulsing animation.

#### A2-LOW-05: `data.ts` view count buffer extraction
- **Sources**: C2-AR-02 (re-confirmation of A1-MED-07)
- **Location**: `apps/web/src/lib/data.ts:1-175`
- **Issue**: View count buffer logic (175 lines) is self-contained and could be extracted into its own module.
- **Fix**: Extract to `lib/view-count-buffer.ts`.

#### A2-LOW-06: `deleteImage` cleanup failures not prominently surfaced to admin
- **Sources**: C2-DB-02
- **Location**: `apps/web/src/app/actions/images.ts:511-516`
- **Issue**: Orphaned files from cleanup failures are logged but not prominently displayed to admin.
- **Fix**: Ensure admin UI displays cleanup warnings prominently.

---

## Summary statistics

- Total findings across all agents: 46 (before dedup)
- Deduplicated findings: 15
- HIGH severity: 1 (7-agent consensus)
- MEDIUM severity: 7
- LOW severity: 6
- Cross-agent agreement (2+ agents): 5 findings (A2-HIGH-01 at 7, A2-MED-01 at 6, A2-MED-02 at 4, A2-MED-03 at 2, A2-MED-04 at 2)
- Cycle 1 fixes verified: 3/3 correct
- Non-issues dismissed: 5
