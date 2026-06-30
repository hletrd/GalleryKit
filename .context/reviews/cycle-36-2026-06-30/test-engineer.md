# Cycle 36 Test Engineer / Verifier Review

Date: 2026-06-30 KST
Reviewed HEAD: `bdfb38a1c39b`
Lane: test coverage adequacy, gate coverage, source-contract tests, brittle tests, custom lint false positives/false negatives, behavior evidence

## Inventory

- Guidance read: `AGENTS.md`, `CLAUDE.md` testing/lint-gate sections, code-review skill, cycle-35 aggregate/comprehensive review.
- Cycle-35 check: did not re-raise C35-01, C35-02, or C35-04. They are not test/gate coverage regressions and I found no fresh test evidence tied to them.
- Unit/source-contract surface: `apps/web/vitest.config.ts` includes `src/__tests__/**/*.test.{ts,tsx}` and excludes `.next`; current suite has 276 Vitest test files.
- E2E surface: 5 Playwright specs under `apps/web/e2e/`, single Chromium worker, local server by default, admin coverage opt-in locally and required in CI when `CI=true`.
- Blocking custom gates inspected deeply:
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
  - Fixtures: `check-api-auth.test.ts`, `check-action-origin.test.ts`, `check-public-route-rate-limit.test.ts`
- Source-contract layer sampled: cycle source-contract files, client/source contracts, touch-target audit, switch/theme/lightbox/picture/semantic contracts. The layer is intentionally structural and brittle in places; the actionable gaps below are where a passing structural gate can miss a relevant exported surface.

## Findings

### C36-TE-01 - `lint:action-origin` ignores wrapped and default exported server-action shapes

Severity: High
Confidence: High
Files:

- `apps/web/scripts/check-action-origin.ts:735`
- `apps/web/scripts/check-action-origin.ts:745`
- `apps/web/scripts/check-action-origin.ts:756`
- `apps/web/scripts/check-action-origin.ts:772`
- `apps/web/src/app/actions/auth.ts:38`
- `apps/web/src/__tests__/check-action-origin.test.ts:434`

The action-origin scanner only evaluates direct `export async function foo()`, `export const foo = async (...) => {}`, and `export const foo = async function (...) {}` declarations. Exported call wrappers and unnamed/default export forms fall through with no pass, skip, or failure.

Current evidence: `src/app/actions/auth.ts` exports `getCurrentUser` as `export const getCurrentUser = cache(async function getCurrentUser() { ... })`, but `npm run lint:action-origin --workspace=apps/web` does not report `getCurrentUser` as either skipped or checked. That export is read-only today, so this is not a current mutation bug, but it proves the scanner cannot see this shape.

Reproduced false negatives:

```ts
export const mutateFoo = cache(async function mutateFoo() {
  await db.insert(rows).values({ ok: true });
});

export default async () => {
  await db.delete(rows);
};
```

Both produce `{ passed: [], failed: [], skipped: [] }` from `checkActionSource(...)`.

Failure scenario: a future server action is wrapped with `cache(...)`, `wrapAction(...)`, or an unnamed default export while performing a DB write. The mutating action can omit `requireSameOriginAdmin()` and keep `lint:action-origin` green, bypassing the repo's CSRF/origin-defense gate.

Fix: fail closed on unsupported exported async-producing shapes. Either unwrap approved call wrappers and inspect the inner async body, or report any exported call-expression initializer/default export as unsupported unless it has an explicit, verified exemption path. Add negative fixtures for `cache(async function ...)`, `wrap(async () => ...)`, `export default async function ()`, and `export default async () => ...`. Also decide whether `getCurrentUser` should be converted to a checked exempt shape or handled by a documented approved-wrapper rule.

### C36-TE-02 - `lint:public-route-rate-limit` misses expensive GET work hidden behind imported helpers or named GET re-exports

Severity: Medium
Confidence: High
Files:

- `apps/web/scripts/check-public-route-rate-limit.ts:60`
- `apps/web/scripts/check-public-route-rate-limit.ts:431`
- `apps/web/scripts/check-public-route-rate-limit.ts:573`
- `apps/web/src/app/uploads/[...path]/route.ts:14`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:14`
- `apps/web/src/lib/serve-upload.ts:61`
- `apps/web/src/lib/serve-upload.ts:189`
- `apps/web/src/lib/serve-upload.ts:281`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:744`

The public-route scanner detects expensive GET work by scanning the local handler body text for a fixed marker list and local helper calls. It does not inspect imported helper bodies and treats named `GET` re-exports from another module as cheap when no local body exists.

Current evidence: both upload fallback routes call `serveUploadFile(...)`, and `serveUploadFile` performs settings lookup plus file `open/stat/createReadStream` work. The gate output still reports both upload route files as `OK ... (no mutating or expensive GET handlers)`, with no explicit exemption comment. A minimal fixture with `import { serveUploadFile } ...; export async function GET(...) { return serveUploadFile(...); }` also passes as cheap.

Reproduced false negative for bodyless re-export:

```ts
export { GET } from './impl';
```

`checkPublicRouteSource(...)` returns `OK: route.ts (no mutating or expensive GET handlers)`, even though `./impl` could be an expensive DB/image route. The test suite currently locks in the non-mutating named-re-export pass path, but does not cover expensive hidden GET bodies.

Failure scenario: a public GET route moves DB/file/image work behind an imported helper or a named re-export. The scanner can classify it as cheap, so the route ships without a rate limit or a deliberate `@public-no-rate-limit-required` exemption. The current upload fallback route is already an example of helper-hidden file/DB work; it may be intentionally unmetered public asset serving, but the gate should require that decision to be explicit.

Fix: fail closed on `GET` named re-exports with a module specifier, or require a reasoned exemption. For imported helpers, either maintain an approved expensive-helper list including `serveUploadFile`, inspect same-repo imported bodies, or require explicit exemptions on helper-backed public GET routes. Add fixtures for `serveUploadFile(...)` and `export { GET } from './impl'` where the target is unknown/expensive. If upload routes are intentionally unmetered, add route-level exemption comments explaining public derivative serving, cache headers, and why rate limiting is not desired.

## Coverage Notes

- The three custom scanner fixture files are strong on many historic failure modes: spoofed imports, star re-exports, alias exports, ignored limiter results, branch ordering around expensive GET work, and public-action rate-limit dominance.
- The remaining source-contract layer is broad but often exact-string based. That is acceptable for narrow architectural tripwires, but it should not replace behavior tests for executable control-flow branches. `upload-processing-contract-lock.test.ts` is a good example of converting an older source-grep guard into behavior coverage.
- Touch-target coverage is intentionally scanner-style and well documented. I did not find a fresh false-positive/false-negative there in this pass.
- E2E coverage covers public navigation/search/photo/shared flows and opt-in admin workflows. I did not run E2E because this lane focused on static gates and unit/source-contract behavior; Playwright starts a server and may depend on local DB/admin credentials.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed, 2 admin API route files checked.
- `npm run lint:action-origin --workspace=apps/web`: passed on current source; output omitted the wrapped `getCurrentUser` export noted above.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed, 10 public route files checked; upload fallback routes classified as non-expensive.
- `npm test --workspace=apps/web -- check-api-auth check-action-origin check-public-route-rate-limit`: passed, 3 files / 119 tests.
- `npm test --workspace=apps/web`: passed, 274 files passed, 2 skipped; 2601 tests passed, 4 skipped.
- Additional `npx tsx -e` fixtures reproduced the action-origin wrapped/default export false negatives and the public-route helper/re-export false negatives.

Not run: `npm run typecheck`, `npm run build`, and `npm run test:e2e`; those are outside this review's narrow artifact scope and may create generated build/typegen/server artifacts.
