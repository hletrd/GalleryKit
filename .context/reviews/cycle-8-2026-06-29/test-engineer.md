# Cycle 8 Test-Engineer Review - 2026-06-29

Role: `test-engineer`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `1e182969`  
Constraint: review-only for implementation files. This report is the only file written.

## Scope And Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory before findings:

- Tracked repository: 2518 files.
- Application source under `apps/web/src`: 490 files.
- Unit test surface under `apps/web/src/__tests__`: 256 files.
- Script/gate surface under `apps/web/scripts`: 27 files.
- Playwright surface under `apps/web/e2e`: 8 files, including 5 specs.
- API route inventory: 8 route files under `apps/web/src/app/api`.
- Server action inventory: 13 action files under `apps/web/src/app/actions`.
- Config/gate inventory: root and app `package.json`, `.github/workflows/quality.yml`, `vitest.config.ts`, `playwright.config.ts`, TypeScript configs, lint scripts, migration/drizzle files, Docker/nginx/deploy scripts.
- Prior/current review context read to avoid duplicates: current Cycle 8 peer reports already present in this directory, run9-cycle8 aggregate/test-engineer reports, and relevant plan/deferred context.

Skipped as non-review-relevant: `node_modules`, `.next`, runtime uploads/resources, binary image/font/ICC fixtures except where used as fixture inventory, raw screenshots, local env files, and generated cache/log output not needed for this test-surface review.

Validation evidence:

- Targeted owner suites are green despite the gaps below: `npm test --workspace=apps/web -- --run check-api-auth.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts analytics.test.ts` passed: 4 files, 94 tests.
- Probe against `checkRouteSource`: a local identity `withAdminAuth` and wrong-module `withAdminAuth` import both return `passed`.
- Probe against `checkActionSource`: a local no-op `requireSameOriginAdmin` returns `passed`.
- Probe against `checkPublicRouteSource`: a bare `// @public-no-rate-limit-required` and an incidental TODO comment containing the tag both return `passed`.

## Findings

### TEST-C8-01 - Auth/origin lint gates trust helper names without proving the helper import

Severity: Medium  
Confidence: High  
Status: Confirmed gate false-confidence risk.

File/region:

- `apps/web/scripts/check-api-auth.ts:64-72`
- `apps/web/scripts/check-action-origin.ts:115-121`
- `apps/web/src/__tests__/check-api-auth.test.ts:12-78`
- `apps/web/src/__tests__/check-action-origin.test.ts:17-129`

Evidence:

- The admin API auth scanner accepts any call expression whose callee identifier text is exactly `withAdminAuth`: `apps/web/scripts/check-api-auth.ts:64-72`. It does not verify that the identifier is imported from `@/lib/api-auth`.
- The action-origin scanner accepts any call expression whose callee identifier text is exactly `requireSameOriginAdmin`: `apps/web/scripts/check-action-origin.ts:115-121`. It does not verify import source from `@/lib/action-guards`.
- The public-route rate-limit scanner already demonstrates the stronger pattern: it collects approved imports from `@/lib/rate-limit` and `@/lib/auth-rate-limit`, then only accepts calls through those imported names (`apps/web/scripts/check-public-route-rate-limit.ts:38-42`, `apps/web/scripts/check-public-route-rate-limit.ts:95-121`).
- Current admin routes use the real helper today (`apps/web/src/app/api/admin/db/download/route.ts:2`, `apps/web/src/app/api/admin/db/download/route.ts:22`, `apps/web/src/app/api/admin/lr/upload/route.ts:22`, `apps/web/src/app/api/admin/lr/upload/route.ts:60`), so this is not a live unwrapped route. The gap is that the blocking gates would fail open on a future spoof.

Concrete failure scenario:

A future admin API route lands with:

```ts
function withAdminAuth(fn: Function) { return fn; }
export const GET = withAdminAuth(async () => new Response('open'));
```

or a mutating action lands with:

```ts
async function requireSameOriginAdmin() { return null; }
export async function deleteThing() {
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  await db.delete(things);
}
```

Both lint gates report OK, so CI gives security reviewers false confidence while the real auth/origin helper is not used.

Concrete fix:

Teach both scanners to build an approved-import map before accepting helper calls. For `check-api-auth`, accept `withAdminAuth` only when imported from `@/lib/api-auth` or when an approved import alias is used. For `check-action-origin`, accept `requireSameOriginAdmin` only when imported from `@/lib/action-guards`. Add negative tests for local helper spoofing and wrong-module imports, plus positive tests for approved aliases.

### TEST-C8-02 - Public-route rate-limit exemption does not enforce the documented reasoned comment

Severity: Low  
Confidence: High  
Status: Confirmed gate completeness issue.

File/region:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-17`
- `apps/web/scripts/check-public-route-rate-limit.ts:286-295`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:79-100`

Evidence:

- The gate header requires an explicit `@public-no-rate-limit-required: <reason>` comment (`apps/web/scripts/check-public-route-rate-limit.ts:1-17`).
- The implementation strips string literals, then passes if the remaining file text merely includes `@public-no-rate-limit-required` anywhere (`apps/web/scripts/check-public-route-rate-limit.ts:286-295`).
- The tests only cover a well-formed comment with a reason and a string-literal false positive (`apps/web/src/__tests__/check-public-route-rate-limit.test.ts:79-100`). There is no negative fixture for a bare tag, empty reason, TODO prose, or a tag in a stale block comment.
- Current public API routes do not rely on the exemption tag today; semantic/OG routes use rate-limit helpers. This is a future-regression gate gap.

Concrete failure scenario:

A new public `POST` route includes a TODO comment such as:

```ts
// TODO: decide whether @public-no-rate-limit-required is appropriate here.
export async function POST() {
  await db.insert(rows).values({ ok: true });
  return Response.json({ ok: true });
}
```

The scanner treats that incidental mention as a conscious exemption and returns OK, even though there is no rate-limit helper and no documented reason.

Concrete fix:

Parse comments explicitly and require the full exemption form with non-empty reason text, e.g. `/@public-no-rate-limit-required:\s*\S/`. Prefer scoping the exemption to leading file or handler comments, not arbitrary trailing/TODO prose. Add tests for bare tag, empty reason, incidental TODO mention, and stale block-comment mention, all expecting `MISSING RATE LIMIT`.

### TEST-C8-03 - Analytics privacy fixtures omit link-local referrers, letting the private-host contract drift

Severity: Low-Medium  
Confidence: High  
Status: Confirmed fixture-realism gap; implementation bug is separately reported by the Cycle 8 critic.

File/region:

- `apps/web/src/lib/analytics.ts:4-10`
- `apps/web/src/lib/analytics.ts:63-77`
- `apps/web/src/lib/analytics.ts:126-136`
- `apps/web/src/__tests__/analytics.test.ts:113-143`

Evidence:

- The privacy contract says private IP referrers are stored as `direct`: `apps/web/src/lib/analytics.ts:4-10`.
- The sanitizer comments say private, loopback, and link-local IPs should be filtered (`apps/web/src/lib/analytics.ts:63-77`).
- The implementation uses `PRIVATE_IP_RE` after stripping IPv6 brackets (`apps/web/src/lib/analytics.ts:126-136`).
- The tests cover RFC1918 IPv4, IPv4 loopback, and IPv6 loopback only (`apps/web/src/__tests__/analytics.test.ts:113-143`). They do not exercise IPv4 link-local `169.254.0.0/16` or IPv6 link-local `fe80::/10`, the ranges called out by the implementation comment.

Concrete failure scenario:

A referrer like `http://169.254.169.254/latest/meta-data/` or `http://[fe80::1]/admin` reaches `sanitizeReferrerHost`. Because the fixture set never asserted link-local behavior, the current drift between the comment/contract and the regex survives with all analytics tests green.

Concrete fix:

Extend `analytics.test.ts` beside the current private-IP block with realistic link-local fixtures:

- `http://169.254.169.254/latest/meta-data/` -> `direct`
- `http://169.254.1.2/page` -> `direct`
- `http://[fe80::1]/page` -> `direct`

Then fix `isPrivateHost` with explicit IP/range parsing or minimally extend the normalized-host checks for `169.254.` and `fe80::/10`.

## Non-Findings And Deduplication

- Current browser and Lightroom upload settings-forwarding source-contract gaps from run9-cycle8 have been addressed: `apps/web/src/__tests__/images-actions.test.ts:264-273` now asserts the browser enqueue payload, and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:358-365` asserts the Lightroom enqueue payload.
- The old inert caption mock is fixed: `apps/web/src/__tests__/image-queue-settings-wiring.test.ts` now mocks `@/lib/caption-generator`.
- Current Cycle 8 code-review/perf findings on unbounded concurrency env parsing and CLIP preprocessing admission are not duplicated here; they need tests as part of their fixes, but the production issue is already filed by the owning role.
- Current Cycle 8 security finding on tracked credential material is not duplicated here; it is outside the test-suite/gate false-confidence surface.
- GET-route rate limiting remains a documented manual-audit boundary. Existing expensive GET routes inspected here have dedicated route/helper tests or source contracts, so I did not file the documented boundary itself as a new issue.

## Final Missed-Issue Sweep

Final sweep covered:

- `withAdminAuth`, `requireSameOriginAdmin`, and public rate-limit gate parser shapes.
- Unit fixtures for auth, origin, public route rate limits, analytics privacy, upload settings, migration/reconcile, privacy fields, touch-target audit, and service-worker contracts.
- Playwright admin/public/origin/nav specs and their CI gating.
- GitHub quality workflow ordering and package scripts.
- Current Cycle 8 peer reports to avoid duplicate findings.

No additional test-coverage, flake, fixture-realism, or gate-completeness issue survived the evidence threshold without duplicating an already-filed Cycle 8 peer finding or known deferred item.
