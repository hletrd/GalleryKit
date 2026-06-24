# Critic Review - review-plan-fix cycle 1, prompt 1

Date: 2026-06-22
Scope: whole repository/change surface from the critic lane, with focus on hidden product risks, overfit assumptions, repo policy drift, missing operational guardrails, inconsistent conventions, and fragile code normalized by prior review loops.
Stop condition: inventory built, high-risk docs/source/config/test surfaces read, cross-file interactions checked, final missed-issues sweep completed. No source code was modified, committed, pushed, or deployed.

## Inventory

Repository inventory was built from `rg --files`, route/action discovery, and targeted reads.

Docs and policy examined:
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `.context/reviews/critic.md` existing stale artifact before replacement
- `.context/reviews/**` and `plan/**` indexes/listings for prior-loop context and recurring review themes

Build, deploy, schema, and guardrail files examined:
- `package.json`
- `apps/web/package.json`
- `scripts/deploy-remote.sh`
- `apps/web/deploy.sh`
- `apps/web/Dockerfile`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`
- `apps/web/drizzle/**`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Application surfaces examined:
- All route files under `apps/web/src/app/api/**`
- All server-action files under `apps/web/src/app/actions/**`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- Admin pages under `apps/web/src/app/[locale]/admin/**`
- Public pages under `apps/web/src/app/[locale]/(public)/**`
- Upload route handlers under `apps/web/src/app/uploads/**`
- `apps/web/src/components/admin-nav.tsx`
- Search UI components under `apps/web/src/components/gallery/**`
- Core libs under `apps/web/src/lib/**`, including data, session, API auth, action guards, rate limiting, CLIP embedding/model helpers, upload serving, restore, SEO, settings, and gallery config
- DB schema under `apps/web/src/db/**`
- Localized messages `apps/web/messages/en.json` and `apps/web/messages/ko.json`

Tests examined:
- Guardrail tests: `check-api-auth.test.ts`, `check-action-origin.test.ts`, `check-public-route-rate-limit.test.ts`, `nginx-config.test.ts`, `privacy-fields.test.ts`, `touch-target-audit.test.ts`
- CLIP/search tests, route tests, migration tests, token tests, restore tests, session/auth tests, client source-contract tests, and data-query tests by targeted read/search

Validation commands run:
- `git status --short` returned clean output before writing this review artifact.
- `npx tsx -e ...` against the three scanner pure functions confirmed the import-only rate-limit, local `withAdminAuth`, and local `requireSameOriginAdmin` bypass fixtures all pass today.

## Findings

### CRIT-01 - Public mutation rate-limit gate passes on import-only files

Severity: High
Confidence: High
Type: Confirmed issue

Code region:
- `apps/web/scripts/check-public-route-rate-limit.ts:1-7` states that every public mutating route must either carry an explicit exemption or call a rate-limit pre-increment helper.
- `apps/web/scripts/check-public-route-rate-limit.ts:151-174` accepts `usesPrefixHelper || importsRateLimitModule`; `importsRateLimitModule` is true when a line imports from `@/lib/rate-limit` or `@/lib/auth-rate-limit`, even if no limiter is invoked.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:141-151` covers the real helper-call success path, but there is no negative fixture for import-only code.

Why this is a problem:
The scanner contract says "calls" a helper, but the implementation treats "imports the module" as equivalent. That creates a fail-open guardrail on a public mutation surface. Prior review loops hardened comments, strings, star exports, and helper-call shape, but normalized a broader bypass that does not enforce the thing the policy says it enforces.

Concrete failure scenario:
A future public `POST` route imports `preIncrementSemanticAttempt` during refactor but forgets to call it before mutation:

```ts
import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
export async function POST() {
  return new Response('ok');
}
```

The scanner currently returns `OK: route.ts (uses rate-limit helper)` with no failures. That route ships as an unmetered public mutation despite `npm run lint:public-route-rate-limit --workspace=apps/web` being green.

Suggested fix:
Remove `importsRateLimitModule` as a pass condition. Parse or scan for an actual call expression to an imported rate-limit helper, preferably by binding imported identifiers from `@/lib/rate-limit` / `@/lib/auth-rate-limit` and requiring a top-level reachable call before the mutation response path. Add a fixture in `check-public-route-rate-limit.test.ts` proving import-only code fails.

### CRIT-02 - Security guard scanners trust local identifier names instead of provenance

Severity: High
Confidence: High
Type: Confirmed issue

Code region:
- `apps/web/scripts/check-api-auth.ts:64-73` unwraps an exported handler initializer and passes when the callee identifier text is exactly `withAdminAuth`; it does not verify the identifier is imported from `@/lib/api-auth`.
- `apps/web/scripts/check-action-origin.ts:107-113` passes any call expression whose callee identifier text is exactly `requireSameOriginAdmin`; it does not verify the identifier is imported from `@/lib/action-guards`.
- `apps/web/scripts/check-action-origin.ts:223-251` then accepts the local guard variable and early return pattern, again without import provenance.
- `apps/web/src/__tests__/check-api-auth.test.ts:13-21` and `apps/web/src/__tests__/check-action-origin.test.ts:32-43,187-199,217-227` cover correct names, but not shadowed/no-op local bindings.

Why this is a problem:
These are load-bearing security lint gates. They protect admin API routes and mutating server actions by verifying wrapper/guard presence, but they only verify identifier spelling. A locally declared or wrongly imported no-op with the same name satisfies the scanner. This is exactly the kind of fragile review-loop pattern that looks hardened because many shapes are tested, while the trust boundary remains text-based.

Concrete failure scenario:
An admin API route can define a no-op wrapper:

```ts
const withAdminAuth = (fn: any) => fn;
export const GET = withAdminAuth(async () => new Response('ok'));
```

The scanner returns `OK: api/admin/foo/route.ts`.

A mutating action can define a no-op origin guard:

```ts
export async function deleteFoo() {
  const requireSameOriginAdmin = async () => null;
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  await db.delete(foo);
  return { success: true };
}
```

The scanner returns `OK: actions/fixture.ts::deleteFoo`.

Suggested fix:
Use TypeScript symbol/import analysis, or a simpler strict source policy, to require:
- `withAdminAuth` is imported from exactly `@/lib/api-auth`, with no local declaration or shadowing.
- `requireSameOriginAdmin` is imported from exactly `@/lib/action-guards`, with no local declaration or shadowing in the checked function scope.

Add negative fixtures for local/no-op bindings and wrong-module imports in both scanner test suites.

### CRIT-03 - Credential-management admin page is outside the nginx admin mutation throttle

Severity: Medium
Confidence: High
Type: Confirmed issue

Code region:
- `apps/web/nginx/default.conf:106-110` rate-limits only `/admin/(categories|tags|users|password|seo|settings)`.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:8-24` defines a real admin tokens page.
- `apps/web/src/app/actions/lr-tokens.ts:22-31` explicitly identifies `createLrToken` as a mutating credential minting action.
- `apps/web/src/app/actions/lr-tokens.ts:80-92` writes an admin token and audit log.
- `apps/web/src/app/actions/lr-tokens.ts:101-115` revokes tokens and writes audit.
- `apps/web/src/__tests__/nginx-config.test.ts:21-23` pins the current nginx rate-limit regex and does not include `tokens`.

Why this is a problem:
The edge policy says admin mutation routes get an nginx throttle. The token management page is a credential-management surface, but it is not in the page-path regex and the token actions do not have their own rate-limit bucket. Same-origin and admin-session checks are necessary, but they are not a substitute for the operational throttle applied to comparable admin mutation pages.

Concrete failure scenario:
With a stolen admin session, malicious browser automation can hit the token page action repeatedly and mint or revoke many Lightroom personal access tokens without the nginx admin page throttle. That can bloat `admin_tokens`, flood audit logs, and create multiple live plaintext credentials during the attack window. The same activity on categories/tags/users/settings/SEO/password is edge-throttled.

Suggested fix:
Add `tokens` to the nginx admin mutation regex and update `nginx-config.test.ts` to pin it. Consider an app-level credential-management limiter as defense in depth, since server actions are security-sensitive and the app already has per-surface rate-limit helpers.

### CRIT-04 - Semantic and similar search silently ignore embeddings outside the newest 5000 rows

Severity: Medium
Confidence: High
Type: Confirmed product risk

Code region:
- `apps/web/src/lib/clip-embeddings.ts:16-18` sets `SEMANTIC_TOP_K_DEFAULT = 20`, `SEMANTIC_TOP_K_MAX = 50`, and `SEMANTIC_SCAN_LIMIT = 5000`.
- `apps/web/src/app/api/search/semantic/route.ts:247-256` scans only embeddings for the active model ordered by `updatedAt DESC` with `.limit(SEMANTIC_SCAN_LIMIT)`.
- `apps/web/src/app/api/search/semantic/route.ts:272-281` scores and ranks only that candidate set.
- `apps/web/src/app/api/search/similar/[id]/route.ts:138-147` applies the same newest-5000 scan to image-to-image search.
- `apps/web/src/app/api/search/similar/[id]/route.ts:158-168` scores and ranks only that candidate set.
- `CLAUDE.md:121` says production currently has about 445 real embeddings, so the cap is not yet active in the current production size.

Why this is a problem:
The cap is a performance shortcut masquerading as complete semantic search. Once the gallery grows past 5000 production embeddings, older photos stop being candidates regardless of semantic similarity. Ordering by embedding `updatedAt` makes search recall depend on backfill/import recency, not user intent. There is no visible product warning, admin health signal, or regression test that defines this as an accepted product limit.

Concrete failure scenario:
A photographer has 8000 processed photos with production embeddings. A user searches for a specific older subject, such as a 2019 venue or a niche object, but those image embeddings are outside the newest 5000 rows. The API returns lower-quality newer matches or no result. Similar-photo search has the same failure mode: an older target image can fail to find its true older sibling shots because they were not in the recency window.

Suggested fix:
Choose and document an intentional retrieval strategy before the cap becomes user-visible. Options include batching through all embeddings, partitioning by topic/date when the user selects filters, moving to a vector index/store, or exposing a clear admin/user limitation while production size is below the threshold. Add a contract test for candidate selection once the strategy is chosen.

### CRIT-05 - Token management exists but is absent from the admin navigation

Severity: Low
Confidence: Medium
Type: Risk needing manual validation

Code region:
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:8-24` implements a localized admin token management page.
- `apps/web/src/components/admin-nav.tsx:15-25` lists dashboard, categories, tags, SEO, settings, password, users, database, and analytics, but not tokens.
- `apps/web/messages/en.json:778-782` and `apps/web/messages/ko.json:827` define visible token-management copy, so this is not merely a dead route/string.

Why this is a problem:
Credential lifecycle management is hidden from the main admin IA. If this route is intentionally operator-only, that intent is not encoded in the navigation or docs I found. If it is intended for admins, the omission makes token revocation harder to discover, which increases the chance of stale Lightroom tokens remaining active.

Concrete failure scenario:
An admin creates a Lightroom token by direct URL during setup, later needs to revoke it, and cannot find the page from the admin UI. They rotate passwords or users instead, leaving the PAT active until someone remembers the direct `/admin/tokens` route.

Suggested fix:
Either add a `tokens` entry to `AdminNav` and localized `nav` labels, or document and test that `/admin/tokens` is deliberately hidden/operator-only. If it remains hidden, add a visible link from the relevant Lightroom/upload setup area so revocation is discoverable.

## Final missed-issues sweep

Searches and checks performed in the final sweep:
- Enumerated every API route under `apps/web/src/app/api/**`.
- Enumerated server actions under `apps/web/src/app/actions/**` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Searched for `withAdminAuth`, `requireSameOriginAdmin`, `@action-origin-exempt`, `@public-no-rate-limit-required`, `preIncrement`, `checkAndIncrement`, `semantic_search_mode`, `SEMANTIC_SCAN_LIMIT`, `tokens`, `lrToken`, `admin_tokens`, `limit_req`, and nginx `/admin/` regexes.
- Checked that the historical Drizzle journal non-monotonicity is documented and guarded by current migration tests/custom migration assertions; I am not reporting the known historical inversion itself as a live issue.
- Checked the documented `/uploads` nginx root caveat against README/app README; it is explicitly documented as host-template dependent, so I am not reporting it as a defect.

Relevant files examined in detail are listed in the Inventory section. I did not exhaustively read every historical `.context/reviews/**` and `plan/**` artifact body because the repository has a very large prior-loop archive; I used their index/listing and read the current policy docs plus source/test surfaces that define live behavior.

Residual risks:
- I did not run the full blocking gate suite (`lint`, `typecheck`, `build`, full Vitest) because this lane is a read-only critique and the findings are static/contract issues. The scanner bypasses were validated directly with the scanner pure functions.
- I did not perform browser/visual QA of admin IA or search UX; CRIT-05 should be manually validated against intended product navigation.
- The production semantic threshold in `clip-embeddings.ts:148-164` is calibrated on limited fixtures plus one real-photo note. That is a product-quality risk to monitor, but I did not promote it to a main finding because the code itself already says to re-validate on real gallery data and the stronger confirmed product issue is the newest-5000 candidate cap.
