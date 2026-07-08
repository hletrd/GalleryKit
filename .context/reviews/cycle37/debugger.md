# Cycle 37 Debugger Review

Role: debugger  
Date: 2026-07-08  
Scope: `/Users/hletrd/flash-shared/gallery`  
Mode: read-only debugger pass; no product code edited, no commit or push.

## Inventory Built Before Review

Instructions read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory:

- `git ls-files`: 3,630 tracked files.
- `apps/web/src`: 633 tracked files.
- `apps/web/src/app`: 81 tracked files.
- `apps/web/src/lib`: 115 tracked files.
- `apps/web/src/components`: 61 tracked files.
- `apps/web/src/__tests__`: 368 tracked files.
- `apps/web/drizzle`: 34 tracked files.
- `apps/web/scripts` plus root `scripts`: 31 tracked files.
- `apps/web/e2e`: 12 tracked files.

Current review-relevant diff at time of this report:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`

Additional cycle 37 review artifacts examined to avoid duplicate findings:

- `.context/reviews/cycle37/code-reviewer.md`
- `.context/reviews/cycle37/security-reviewer.md`
- `.context/reviews/cycle37/perf-reviewer.md`
- `.context/reviews/cycle37/verifier.md`
- `.context/reviews/cycle37/critic.md`

Primary files examined:

- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/__tests__/settings-hash.test.ts`
- `apps/web/src/__tests__/cycle-11-source-contracts.test.ts`
- `apps/web/src/lib/settings-hash.ts`
- `apps/web/src/lib/settings-submit-payload.ts`
- `apps/web/src/lib/settings-normalization.ts`
- representative current cycle reviews and route/action/config sweeps under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/scripts`, and `apps/web/e2e`

## Findings

### DBG37-01: New `GalleryConfig` required fields break the blocking typecheck

- Severity: High
- Confidence: High
- Status: Confirmed
- Files/lines:
  - `apps/web/src/lib/gallery-config.ts:92-94` adds required `showTimelineNav` and `showMapNav` properties to `GalleryConfig`.
  - `apps/web/src/lib/gallery-config.ts:146-154` populates those properties from `show_timeline_nav` / `show_map_nav`.
  - `apps/web/src/__tests__/settings-hash.test.ts:153-169`, `187-203`, and `229-240` still construct `GalleryConfig` fixtures without those required properties.

Concrete failure scenario:

`npm run typecheck --workspace=apps/web` fails before the scripts typecheck phase. The app typecheck reports that the `settings-hash.test.ts` `GalleryConfig` object literals are missing `showTimelineNav` and `showMapNav`, so the branch cannot pass the repo's blocking quality gate or CI.

Validation evidence:

```text
npm run typecheck --workspace=apps/web
```

failed with:

```text
src/__tests__/settings-hash.test.ts(153,55): error TS2345: ... missing the following properties from type 'GalleryConfig': showTimelineNav, showMapNav
src/__tests__/settings-hash.test.ts(187,55): error TS2345: ... missing the following properties from type 'GalleryConfig': showTimelineNav, showMapNav
src/__tests__/settings-hash.test.ts(229,15): error TS2739: ... missing the following properties from type 'GalleryConfig': showTimelineNav, showMapNav
```

Suggested fix:

Add `showTimelineNav` and `showMapNav` to every full `GalleryConfig` fixture, or introduce a shared complete `baseGalleryConfig` test helper so future config fields are updated once. Because these settings do not affect derivative bytes, keep them out of `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` / `CONFIG_HASH_VALUE_MAPPERS`.

### DBG37-02: The new browse-link visibility settings hide only the header, not other first-party discovery surfaces

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Files/lines:
  - `apps/web/src/lib/gallery-config-shared.ts:68-70`, `147-149`, and `219-221` add `show_timeline_nav` / `show_map_nav` with comments describing admin-toggleable nav visibility.
  - `apps/web/src/components/nav.tsx:14-31` passes the resolved flags to `NavClient`.
  - `apps/web/src/components/nav-client.tsx:35-49` hides only the header browse links.
  - `apps/web/src/components/footer.tsx:45-50` always renders footer links to `/timeline` and `/map`.
  - `apps/web/src/app/sitemap.ts:25` always includes `/timeline` and `/map` in `STATIC_PUBLIC_PATHS`, and `apps/web/src/app/sitemap.ts:100-106` emits them to crawlers.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-920` exposes Settings switches that imply this is an operator-facing visibility control.

Concrete failure scenario:

An admin turns off "show map nav" expecting the public map browse entry to be hidden. The header link disappears, but the footer still links to `/map` on every public page and `/sitemap.xml` still advertises `/map` to crawlers. That creates a misleading partial-hide state rather than a coherent visibility contract.

Suggested fix:

Decide the intended scope of these settings. If they mean "hide from all first-party discovery", feed `getGalleryConfig()` into `Footer` and `sitemap()`, omit hidden paths from both, and add source/runtime tests that set each flag false and assert header, footer, and sitemap behavior. If they only mean "header nav preference", rename the labels/comments to say header-only.

## Validation

Commands run from repo root:

- `npm run typecheck --workspace=apps/web` failed as described in DBG37-01.
- `npm test --workspace=apps/web -- src/__tests__/client-source-contracts.test.ts src/__tests__/cycle-11-source-contracts.test.ts src/__tests__/settings-hash.test.ts` passed: 3 files, 47 tests.

I did not run the full lint/build/unit/e2e/audit suite after the typecheck failure because the branch is already blocked by the mandatory type gate.

## Final Missed-Issues Sweep

Final sweep covered:

- Current uncommitted diff and status.
- New config keys, defaults, validators, config resolution, settings update allowlist, settings normalization and payload diff.
- Header nav, footer, sitemap, settings UI, message files, and source-contract tests for timeline/map.
- Existing cycle 37 code/security/performance/verifier/critic reviews.
- Broad static search for route/action error handling, restore barriers, rate-limit rollback, advisory locks, `formData()`, public route discovery, and map/timeline references.

No additional high-confidence debugger findings were confirmed beyond the two above. Remaining risk areas not re-proven in this pass are live browser behavior for the nav/footer changes, full CI after the typecheck fix, and production-specific sitemap/cache behavior after any future visibility-contract decision.
