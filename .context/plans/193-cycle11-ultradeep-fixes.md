# Plan 193 — Cycle 11 Ultradeep Fixes

**Source review:** Cycle 11 Aggregate Review (`C11-01` through `C11-07`)
**Status:** DONE
**User-injected TODOs honored this cycle:** `deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`, `go on`

## Findings to Address This Cycle

| ID | Description | Severity | Confidence |
|---|---|---|---|
| C11-01 | Non-ASCII tag names collapsed into empty/colliding slugs | HIGH | HIGH |
| C11-02 | Share creation coupled photo/group in-memory rate limits and charged copy-again flows | MEDIUM | HIGH |
| C11-03 | Topic aliases allowed dotted segments that bypass locale middleware | MEDIUM | HIGH |
| C11-04 | Login lacked a same-origin request guard | MEDIUM | MEDIUM |
| C11-05 | Lightbox controls auto-hide on touch-only devices | MEDIUM | HIGH |
| C11-06 | Tag input trapped Tab and failed to canonicalize case-variant existing tags | LOW | HIGH |
| C11-07 | Runtime/deploy hardening still carried build-only toolchain packages and merge-capable pulls | MEDIUM | HIGH |

## Implementation Plan

1. **Unicode-safe tag slugs**
   - Update tag slug generation to preserve Unicode letters/numbers instead of collapsing them to empty strings.
   - Add tag-specific slug validation and regression coverage for Korean/CJK inputs.

2. **Scoped/idempotent share rate limiting**
   - Split in-memory share buckets by action type.
   - Return an existing photo share key before consuming new-share budget.

3. **Alias/middleware contract repair**
   - Reject new dotted aliases so admin validation matches locale middleware routing.
   - Add regression coverage for dotted alias rejection.

4. **Same-origin login guard**
   - Add a request-origin helper and reject cross-origin login POSTs.
   - Lock the helper with direct unit tests.

5. **Lightbox and tag-input UX hardening**
   - Keep lightbox controls visible on touch-only devices and expose a clearer fullscreen exit label.
   - Let Tab move focus normally in tag input, and canonicalize case variants to existing tags.

6. **Runtime/deploy hardening**
   - Split build-only tooling out of the runtime Docker stage.
   - Fail remote deploy pulls unless they fast-forward cleanly.

## Verification Goals

- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- Per-cycle deploy command succeeds after green gates:
  - `ssh -i ~/.ssh/atik.pem ubuntu@gallery.atik.kr "cd /home/ubuntu/gallery && bash apps/web/deploy.sh"`

## Completion Notes

- [x] `C11-01` implemented via Unicode-safe tag slug generation/validation plus regression coverage.
- [x] `C11-02` implemented by scoping in-memory share budgets per action and skipping budget burn for existing photo share keys.
- [x] `C11-03` implemented by rejecting new dotted aliases while keeping legacy dotted aliases deletable.
- [x] `C11-04` implemented with a same-origin request helper for login POSTs, including local HTTP fallback coverage.
- [x] `C11-05` + `C11-06` implemented in lightbox/tag-input UX helpers and tests.
- [x] `C11-07` implemented by slimming the runner image and forcing remote deploys to fast-forward cleanly.

## Verification Results

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
