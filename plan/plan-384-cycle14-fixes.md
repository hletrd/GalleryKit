# Cycle 14/100 Implementation Plan

Source review: `.context/reviews/_aggregate.md` (`C14-AGG-*`)
Status: TODO

## Scheduled Work

### WP1 - Current-cycle provenance ledger

Findings: `C14-AGG-01`

Scope:
- Keep `.context/reviews/_aggregate.md` as the canonical Cycle 14 aggregate.
- Update `.context/plans/README.md` current-cycle pointers so agents do not follow Cycle 13 as active state.
- Record this plan/deferred pair as the active Cycle 14 ledger.

Acceptance:
- `.context/reviews/_aggregate.md` title and IDs are Cycle 14.
- `.context/plans/README.md` points to this Cycle 14 plan/deferred pair.

Progress:
- [x] Implemented
- [x] Verified

### WP2 - Proxy topology checker truthfulness

Findings: `C14-AGG-03`

Scope:
- Narrow `scripts/check-proxy-topology.mjs` help and success output so it no longer claims to prove forwarded-client-IP bucket safety from status codes alone.
- Keep the same non-destructive same-origin/spoofed-forwarded-header probe behavior.
- Add/adjust source-contract coverage so future wording does not overclaim XFF overwrite proof.

Acceptance:
- Script output distinguishes "same-origin/spoofed forwarded header reachability passed" from "client-IP bucket safety verified".
- Tests assert the limitation text is present.

Progress:
- [x] Implemented
- [x] Verified

### WP3 - Static public sitemap coverage

Findings: `C14-AGG-23`

Scope:
- Define one shared static public sitemap path list for `/timeline`, `/map`, `/privacy`, and `/about-gallerykit`.
- Use that list in sitemap budget reservation, entry emission, and fallback behavior.
- Update sitemap tests to expect every localized static public path.

Acceptance:
- Sitemap emits localized rows for every public footer destination.
- Budget reservation and fallback tests account for the expanded static path list.

Progress:
- [x] Implemented
- [x] Verified

### WP4 - Bottom save affordance for long settings form

Findings: `C14-AGG-19`

Scope:
- Add a repeated Save action after the final settings group, reusing the existing save handler and pending state.
- Keep the top Save button unchanged.
- Add a focused test/source contract for the repeated bottom save affordance.

Acceptance:
- Admins editing lower settings have a nearby Save button.
- Touch target remains at least 44 px.

Progress:
- [x] Implemented
- [x] Verified

## Verification

- Targeted: `npm test --workspace=apps/web -- --run src/__tests__/sitemap-robots.test.ts src/__tests__/cycle12-ops-contracts.test.ts src/__tests__/settings-save-affordance-source.test.ts` - passed (3 files, 13 tests).
- `npm run lint --workspace=apps/web` - passed.
- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web` - passed.
- `npm test --workspace=apps/web` - passed (347 files passed, 2 skipped; 3198 tests passed, 4 skipped).
- `npm run test:e2e --workspace=apps/web` - not run; browser-flow coverage was not required for the source/docs/sitemap changes in this cycle, and cycle 14 instructed avoiding extra local MySQL container work unless browser coverage was truly required.

## Deferred Findings

All other Cycle 14 aggregate findings are recorded with preserved severity/confidence and exit criteria in `plan/plan-385-cycle14-deferred.md`.
