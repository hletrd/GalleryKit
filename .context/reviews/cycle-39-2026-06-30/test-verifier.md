# Cycle 39 Test / Verifier Review

Scope: static lint gates and regression-test coverage at `addf64ac`.

## TEST-C39-01 - `lint:action-origin` does not constrain the top-level action barrel

Severity: medium.

Evidence:
- `apps/web/scripts/check-action-origin.ts:84` discovers `src/app/actions/**` plus `src/app/[locale]/admin/db-actions.ts`.
- `apps/web/src/app/actions.ts` is the primary compatibility import surface and currently lives outside that discovery set.

Impact: the barrel is pure re-exports today, but a future direct `export async function` in `app/actions.ts` would bypass the origin lint gate.

Recommendation: include the barrel in the scanner and add a pure-barrel contract that allows only action-module re-exports plus type-only exports.

## TEST-C39-02 - Public route rate-limit lint ignores expensive `HEAD` handlers

Severity: medium.

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:37-39` protects mutating methods and expensive `GET` only.
- Upload derivative route files export `HEAD` and call `serveUploadFile`.

Impact: current upload routes share a reasoned file exemption, but a future public `HEAD` route doing DB/image/filesystem work without a limiter or exemption would pass the lint gate.

Recommendation: treat `HEAD` as an expensive read method alongside `GET`, while preserving the documented GET/HEAD upload exemption shape.
