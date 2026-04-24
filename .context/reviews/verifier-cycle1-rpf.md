# Cycle 1 Review — Verifier

## Inventory Reviewed
I examined the behavior-bearing docs, config, tests, and implementation files in scope for the gallery app. No sampling: I walked the relevant file sets end-to-end.

### Docs / config / entrypoints
- `README.md`
- `apps/web/README.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/proxy.ts`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/scripts/ensure-site-config.mjs`
- `scripts/deploy-remote.sh`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`

### Functional source reviewed
- All server actions under `apps/web/src/app/actions/` (9 files)
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- All route/page files under `apps/web/src/app/` and `apps/web/src/app/[locale]/` that participate in public/admin behavior (43 files)
- All shared libraries under `apps/web/src/lib/` (44 files)
- All shared UI/components under `apps/web/src/components/` (44 files)
- Database / i18n / runtime support: `apps/web/src/db/*`, `apps/web/src/i18n/request.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`

### Tests reviewed
- All unit tests under `apps/web/src/__tests__/` (50 files)
- All Playwright specs under `apps/web/e2e/` (8 files)

## Verification Performed
- `npm --workspace=apps/web test` → **50 passed**, **298 tests passed**
- `npm --workspace=apps/web run lint` → exited 0
- `npm --workspace=apps/web run build` → exited 0

## Findings

### 1) Search failures can leak rate-limit budget
**Severity:** Medium
**Confidence:** High
**Status:** Confirmed

**Files / regions**
- `apps/web/src/app/actions/public.ts:64-97`
- `apps/web/src/lib/data.ts:725-831`

**What I found**
`searchImagesAction()` pre-increments both the in-memory and DB-backed search rate-limit counters, then returns `searchImages(safeQuery, 20)` without any rollback path if `searchImages()` throws.

**Failure scenario**
If the search query hits a transient DB/SQL failure after the pre-increment, the request rejects but the counters stay inflated. A legitimate user can then be throttled as if they had consumed a successful search, even though the request failed.

**Suggested fix**
Wrap the final `searchImages()` call in `try/catch` and symmetrically roll back both counters on any exception, using the same decrement/delete pattern already used for the over-limit branch.

**Test gap**
`apps/web/src/__tests__/public-actions.test.ts` covers over-limit rollback and DB increment failure, but not a `searchImages()` exception after the increment.

---

### 2) The H3 hierarchy assertion in the homepage E2E is vacuous
**Severity:** Medium
**Confidence:** High
**Status:** Confirmed

**File / region**
- `apps/web/e2e/public.spec.ts:85-98`

**What I found**
The test claims to verify a full `H1 -> H2 -> H3` hierarchy, but the final assertion is `expect(h3Count).toBeGreaterThanOrEqual(0)`, which can never fail.

**Failure scenario**
If photo-card headings disappear entirely or regress to the wrong level, this test still passes and the accessibility regression goes undetected.

**Suggested fix**
Assert `h3Count > 0` when seeded photos are present, or otherwise make the expectation conditional on the fixture state the test depends on.

---

### 3) The auth gates can be bypassed by non-direct exports
**Severity:** High
**Confidence:** Medium
**Status:** Likely risk

**Files / regions**
- `apps/web/scripts/check-action-origin.ts:148-223`
- `apps/web/scripts/check-api-auth.ts:86-135`

**What I found**
Both scanners only inspect direct exported declarations. The server-action scanner checks only `export async function ...`, `export const ... = async (...) => ...`, and `export const ... = async function ...`. The API scanner checks only exported variable declarations / function declarations named `GET`, `POST`, etc.

**Failure scenario**
A future file could define an authenticated handler or mutating action through an alias/re-export pattern such as `const GET = withAdminAuth(...); export { GET };` or `const mutate = async () => { ... }; export { mutate };`. Those forms would be skipped by the current scanners, letting a protected endpoint land without the intended gate.

**Suggested fix**
Teach the scanners to resolve `ExportDeclaration` / alias exports, or forbid aliased exports for these surfaces with a dedicated lint rule. For the action scanner, also decide whether non-async exported mutators should be treated as in-scope instead of silently skipped.

## Missed-Issues Sweep
I rechecked the remaining high-risk surfaces after the initial pass:
- admin auth / same-origin checks
- upload / restore / backup paths
- rate limiting and rollback helpers
- public search and metadata helpers
- e2e coverage around navigation, search, and admin flows

No additional confirmed correctness mismatches stood out beyond the findings above.
