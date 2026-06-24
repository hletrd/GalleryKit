# Verifier Review — review-plan-fix cycle 1 prompt 1

**Repo:** `/Users/hletrd/flash-shared/gallery`
**HEAD inspected:** `1d5545cbf3840fc449fb67998104b5d5f2aab433`
**Date:** 2026-06-22
**Role:** verifier lane, evidence-based correctness review against AGENTS.md / CLAUDE.md / docs / tests / scripts / source.
**Write scope:** this review artifact only. No source edits, commits, pushes, or deploys.

## Inventory

Primary contracts read:

- `AGENTS.md`: git/deploy/schema/quality-gate/touch-target/privacy-review rules.
- `CLAUDE.md`: security model, privacy contract, migration runbook, deploy helper/disk hygiene, lint gates, touch-target audit, runtime topology.
- Root/package gates: `package.json`, `apps/web/package.json`.

Focus-area source/tests read:

- Deploy: `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`.
- Migration/schema: `apps/web/drizzle/meta/_journal.json`, all tracked `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/migration-journal*.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/map-privacy.test.ts` was identified as related by search.
- Lint gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and their fixture tests.
- Current gated surfaces: `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/**/route.*`, `apps/web/src/app/api/**/route.*`.
- Touch target: `apps/web/src/__tests__/touch-target-audit.test.ts` and representative component references.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` — exit 0.
- `npm run lint:action-origin --workspace=apps/web` — exit 0 on current source.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — exit 0 on current source.
- `npm test --workspace=apps/web -- migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts privacy-fields.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts check-api-auth.test.ts` — 7 files passed, 127 tests passed.
- Additional scanner probes with `npx tsx -e` confirmed the lint-gate false negatives below.

## Findings

### 1. HIGH — Confirmed issue — `lint:action-origin` accepts mutation before the origin error is returned

**Evidence region:**

- `AGENTS.md:33` and `CLAUDE.md:545-548` state every mutating server action must return early on `requireSameOriginAdmin()`.
- `apps/web/src/lib/action-guards.ts:29-32` documents the intended caller shape:
  `const originError = await requireSameOriginAdmin(); if (originError) return ...`.
- `apps/web/scripts/check-action-origin.ts:234-248` finds a guard variable, rejects mutations only in statements before the guard call, then accepts any later statement that returns on that variable.
- `apps/web/scripts/check-action-origin.ts:142-153` treats any binary condition containing the guard variable as a valid guard check, without verifying that the condition returns when the value is present/truthy.
- `apps/web/src/__tests__/check-action-origin.test.ts:73-85` covers mutation before the guard call, but there is no fixture for mutation between the guard call and the `if`, nor for inverted conditions.

**Why this is a problem:**

The scanner can report `OK` while the action performs a DB mutation before checking the failed origin result. It also accepts a wrong-branch condition such as `if (originError === null) return ...`, which returns on trusted requests and lets untrusted-origin requests continue to mutate.

**Concrete failure scenario:**

This fixture passed the gate during verification:

```ts
export async function updateFoo() {
  const originError = await requireSameOriginAdmin();
  await db.insert(foo).values({});
  if (originError) return { error: originError };
  return { success: true };
}
```

The probe output was:

```json
{"passed":["OK: actions/fixture.ts::updateFoo"],"failed":[],"skipped":[]}
```

An implementation with that shape would mutate state on a cross-origin request before returning the error.

**Suggested fix:**

Make the scanner prove the top-level sequence, not just the presence of both pieces:

- Require the guard-return statement to be the next effective statement after the guard variable, allowing only explicitly safe declarations if needed.
- Reject any mutating call between the guard declaration and the return.
- Restrict accepted conditions to `if (originError)` or equivalent presence checks (`originError != null` / `originError !== null` if desired), and reject inverted/success-branch checks.
- Add fixtures for mutation-between-guard-and-return and inverted binary conditions.

**Severity:** High.
**Confidence:** High.

### 2. MEDIUM — Confirmed issue — `lint:action-origin` silently passes star re-exports

**Evidence region:**

- `CLAUDE.md:545-548` says the action-origin scanner covers server-action-capable files under `app/actions/` recursively and requires exported mutating functions to be checked or explicitly exempted.
- `apps/web/scripts/check-action-origin.ts:314-323` rejects named export declarations, but only when `statement.exportClause` is a named export list.
- There is no fail-closed branch for `export * from './impl'`; the loop ignores it and returns an empty report.
- `apps/web/src/__tests__/check-action-origin.test.ts:303-350` covers recursive discovery and exclusions, but has no fixture for star re-export hiding action exports.

**Why this is a problem:**

A future action file can hide exported server actions behind `export * from './impl'`. The scanner will not inspect the implementation and will not fail closed. That breaks the stated gate that every mutating server action is covered.

**Concrete failure scenario:**

This fixture passed with no failures and no skips:

```ts
export * from './impl';
```

If `./impl` exports a mutating server action without `requireSameOriginAdmin()`, the gate remains green.

**Suggested fix:**

Mirror the public-route scanner's fail-closed behavior: any star re-export in a scanned action file should fail with instructions to export audited functions directly. Add a regression fixture.

**Severity:** Medium.
**Confidence:** High.

### 3. MEDIUM — Confirmed issue — `lint:public-route-rate-limit` accepts any rate-limit import, not a pre-increment call

**Evidence region:**

- `AGENTS.md:34` says every public API route exporting a mutating handler must call a rate-limit pre-increment helper or carry an explicit exemption.
- `CLAUDE.md:550-554` repeats that requirement and names helpers beginning with `preIncrement` or `checkAndIncrement`.
- `apps/web/scripts/check-public-route-rate-limit.ts:156-168` separately computes `usesPrefixHelper` and `importsRateLimitModule`.
- `apps/web/scripts/check-public-route-rate-limit.ts:170-174` passes when `usesPrefixHelper || importsRateLimitModule`, so a bare import from `@/lib/rate-limit` is enough.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:103-152` guards commented-out helper calls, but does not test import-without-call.

**Why this is a problem:**

The blocking gate can be satisfied by importing a harmless helper such as `getClientIp` while never incrementing any rate-limit bucket. The success message says "uses rate-limit helper", but no rate-limit decision happened.

**Concrete failure scenario:**

This mutating public route fixture passed:

```ts
import { getClientIp } from '@/lib/rate-limit';

export async function POST(req) {
  const ip = getClientIp(req.headers);
  return Response.json({ ok: true });
}
```

The probe output was:

```json
{"passed":["OK: api/foo/route.ts (uses rate-limit helper)"],"failed":[]}
```

A future public POST route could ship unmetered while the documented gate stays green.

**Suggested fix:**

Remove `importsRateLimitModule` from the pass condition. Require an executable `preIncrement*(` or `checkAndIncrement*(` call after string/comment stripping, or a real `@public-no-rate-limit-required: <reason>` comment. Add a fixture that imports only `getClientIp` and must fail.

**Severity:** Medium.
**Confidence:** High.

### 4. LOW — Risk needing manual validation — Touch-target policy is stricter than the audit's allowlisted behavior

**Evidence region:**

- `AGENTS.md:43` states "Touch targets: 44 px minimum on every interactive element. Enforced by `__tests__/touch-target-audit.test.ts`."
- `CLAUDE.md:559-563` says all interactive elements must present at least 44x44 px and that the test enforces this as blocking.
- `apps/web/src/__tests__/touch-target-audit.test.ts:92-110` defines `KNOWN_VIOLATIONS` as "known < 44 px touch targets" with documented exemptions.
- `apps/web/src/__tests__/touch-target-audit.test.ts:183-189` and `224-238` allow nonzero counts for admin/dashboard/category/tag/settings/SEO surfaces.
- `apps/web/src/__tests__/touch-target-audit.test.ts:755-766` fails only when actual findings exceed the allowlisted count, not when any sub-44 finding exists.

**Why this is a problem:**

The docs imply a zero-tolerance invariant. The test is actually an allowlist/budget system. Some entries are likely scanner false positives because `apps/web/src/components/ui/button.tsx:24-26` floors shadcn button variants at `min-h-11` / `size-11`, but the audit file itself still describes its map as known sub-44 targets. That makes the policy hard to reason about: future reviewers may believe `npm test` proves zero sub-44 targets when it can pass with allowlisted findings.

**Concrete failure scenario:**

A developer changes an allowlisted admin button without improving its hit area, keeps the same count, and the audit passes. The final test output still supports the project claim "touch target audit passed", even though the stated "every interactive element" invariant is not actually proven.

**Suggested fix:**

Either align docs to the real policy ("public/mobile-priority zero tolerance; documented admin exceptions budgeted") or make the audit zero-tolerance by retiring nonzero budgets and adding targeted false-positive suppressions that prove runtime 44px sizing.

**Severity:** Low.
**Confidence:** Medium.

## Non-Findings

- Migration journal non-monotonicity is documented historical debt, not a new issue. `apps/web/drizzle/meta/_journal.json:55-60` has the `0006` to `0007` inversion, but `CLAUDE.md:375-395`, `apps/web/src/__tests__/migration-journal.test.ts:19-32`, and `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:44-54` explicitly grandfather it and guard all new entries against stale `when` values. Targeted migration tests passed.
- The deploy disk-hygiene claim matches source: `apps/web/deploy.sh:31-56` runs compose first, then container/image/builder/volume prune; `apps/web/docker-compose.yml:23-26` uses bind mounts for `data`, `public`, and `site-config.json`. I did not execute deploy.
- Privacy guards are consistent in the reviewed field sets: `apps/web/src/lib/data.ts:323-355` omits the sensitive fields from `publicSelectFields`, `data.ts:414-429` carries compile-time guards, and `apps/web/src/__tests__/privacy-fields.test.ts:6-42` / `83-114` assert runtime key symmetry. Targeted privacy tests passed.
- Current source passes existing lint gates. The findings above are false-negative gaps in the gate implementations, not current-source failures found in existing action/route bodies.

## Missed-Issues Sweep

Final sweep actions:

- Searched repo contracts and focus terms with `rg` across `AGENTS.md`, `CLAUDE.md`, `apps/web/src`, `apps/web/scripts`, and `apps/web/drizzle`.
- Enumerated tracked docs/source/test files with `git ls-files` for the requested focus areas.
- Read all migration SQL files and the journal.
- Read current deploy helper and container startup path.
- Read current admin API routes, public API routes, and server actions for cross-file interaction with the lint gates.
- Ran the three custom lint gates and targeted Vitest suites listed in the inventory.
- Ran custom scanner probes to validate the false negatives.
- Confirmed `git status --short` was clean before writing this review artifact.

Residual risk:

- I did not run the full `npm run lint`, `npm run typecheck`, `npm run build`, or full `npm test` suite because this prompt requested a verifier review artifact rather than a release gate run. The targeted gates/tests tied to the reviewed contracts passed.
- I did not connect to a live MySQL database or deploy host, so migration/deploy conclusions are source/test based, not live-environment validation.

## Recommendation

Request changes for the lint-gate gaps before relying on the blocking gates as proof of the documented security/rate-limit invariants. The highest-priority fix is `check-action-origin.ts`, because it can currently certify an action that mutates before returning on a failed same-origin check.
