# Plan 301 — Run-4 Cycle 15 fixes

**Source review:** `.context/reviews/run4-cycle15/_aggregate.md`
**Status:** IMPLEMENTED — all four tasks landed (see Progress log)

Gates for this cycle (all must be green before each push): eslint,
typecheck, vitest, api-auth lint, action-origin lint,
public-route-rate-limit lint, production build, playwright e2e.
Per-cycle deploy (`npm run deploy`) after all work lands.

## Task 1 — COR-R4C15-01: OLED-aware global error shell (MED/High, 6/6 cross-angle)

**Files:**
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/__tests__/error-shell.test.ts`

**Changes:**
1. `lib/error-shell.ts`: extend `ErrorShellDocumentLike` with an
   optional `documentElement.classList` shape
   (`{ contains(token: string): boolean } | null`), add pure
   `resolveErrorShellThemeClass(documentLike): 'oled' | 'dark' | null`
   — `oled` wins over `dark` (defensive both-classes case), `null`
   when neither/absent. Closed return contract so a future 5th theme
   forces a conscious decision.
2. `global-error.tsx`: replace `detectDarkMode()` with the helper
   (`const themeClass = resolveErrorShellThemeClass(typeof document
   === 'undefined' ? null : document)`); render
   `<html className={themeClass ?? undefined}>`. Behavior for `dark`
   users unchanged; `oled` users now keep the true-black token set
   (`globals.css` `.oled`).
3. `error-shell.test.ts`: cases — `oled` → `'oled'`, `dark` →
   `'dark'`, both → `'oled'`, neither → `null`, no document /
   no classList → `null`. Prove the equivalent pre-fix behavior fails
   (oled case) before applying the component edit.
4. Commit body cites `lib/theme.ts` THEME_VALUES as the authoritative
   4-theme contract (DOC-R4C15-01) and TEST-R4C15-01.

**Acceptance:** new tests green (oled case proven failing pre-fix);
typecheck green (classList shape is structural — jsdom Document
satisfies it); no behavior change for light/dark users.

## Task 2 — PERF-R4C15-02: sized + CDN-correct map popup thumbnails (MED/High, 6/6 cross-angle)

**Files:**
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/map/map-loader.tsx`
- `apps/web/src/components/map/map-client.tsx`
- new `apps/web/src/__tests__/map-thumb-wiring.test.ts`

**Changes:**
1. `map/page.tsx`: fetch `getGalleryConfig()` in the existing
   `Promise.all` (React cache() — zero marginal DB cost) and pass
   `imageSizes={config.imageSizes}` to `MapLoader`.
2. `map-loader.tsx`: add `imageSizes: number[]` to `MapLoaderProps`,
   forward.
3. `map-client.tsx`: add `imageSizes` prop; new `MarkerThumb`
   sub-component (header cites R23-M1 / PERF-R4C15-02) mirroring
   `SearchResultItem`: `sizedImageUrl('/uploads/jpeg', filename, 128,
   imageSizes)` initial src, `imageUrl('/uploads/jpeg/…')` base
   fallback, one-shot `onError` ref guard. Replace the raw
   `<img src={'/uploads/jpeg/' + …}>` in the popup. Keep
   width/height/objectFit and the eslint no-img-element carve-out
   (plain `<img>` stays correct inside Leaflet popups — next/image
   gains nothing in a portal that mounts on open).
4. New source-inspection fixture `map-thumb-wiring.test.ts`
   (TEST-R4C15-03, convention per `wide-gamut-predicate-wiring.test.ts`):
   map-client imports `sizedImageUrl` + `imageUrl` from
   `@/lib/image-url`; contains NO raw `` `/uploads/jpeg/${…}` ``
   src interpolation outside the helper calls; map-loader + map-client
   prop surfaces carry `imageSizes`; map page passes
   `config.imageSizes`. Prove failing against pre-fix source.
5. Commit body notes the CDN sub-bug (`imageUrl` bypass) and cites
   R21-M1/R22-M1/R23-M1 lineage (DOC-R4C15-02).

**Acceptance:** popup thumb requests `…_640.jpg`-class derivative
(nearest to 128 from configured sizes — for default sizes, 640);
legacy photos without sized derivatives fall back to base on first
error; fixture green; full vitest green.

## Task 3 — DES-R4C15-03: 44 px tag-filter chips + audit extension (MED/High, 6/6 cross-angle; folds TEST-R4C15-02; fires OBS-R4C14-A exit criterion)

**Files:**
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `CLAUDE.md` (one line in Touch-Target Audit § Pattern coverage)

**Changes:**
1. `tag-filter.tsx:62,79`: `min-h-[32px]` → `min-h-11` (both Badge
   classNames). Visual consistency: nav topic pills already
   `min-h-[44px]` with the same rounded-full px-3 language.
2. Audit extension (ORDER: land the audit patterns FIRST and run the
   suite to prove they fail against the pre-fix tag-filter source —
   2 violations in an unlisted file — then apply the chip fix and
   re-run green):
   - `normalizeMultilineButtonTags` regex: `/<(Button|button)\b/g` →
     `/<(Button|button|Badge)\b/g` (rename narration accordingly).
   - FORBIDDEN additions (each with the established
     `(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)` compliant-
     override lookahead):
     - `<Button` with `min-h-\[(?:\d|[123]\d|4[0-3])px\]` in className
       (string-literal AND cn-composite forms);
     - `<button` same;
     - `<Badge` with `\basChild\b` AND sub-44 `min-h-[NNpx]`
       (string-literal AND cn-composite forms) — gated on `asChild`
       so decorative (span) badges never trip.
   - Violation fixtures: `<Badge asChild className={cn("min-h-[32px]",…)}>`,
     `<button className="min-h-[40px]">`, `<Button className="min-h-[36px]">`.
   - Compliant fixtures: `min-h-11` chip, `min-h-[44px]`,
     non-asChild `<Badge className="min-h-[32px]">`,
     `<Button className="min-h-[40px] min-h-11">`-style override.
   - **OBS-R4C14-A closure** (exit criterion fired by this functional
     edit): refresh the FORBIDDEN/KNOWN_VIOLATIONS narration to the
     post-lift `ui/button.tsx` defaults (all size variants ≥ 44 px:
     `min-h-11`/`size-11`/`min-h-12`/`size-12`); document the decision
     to KEEP the bare `size="sm"`/`size="icon"` patterns and their
     exemption entries as belt-and-braces against a future button.tsx
     variant downgrade (the scanner cannot see variant CSS), per the
     re-evaluation the deferral demanded.
3. CLAUDE.md Touch-Target § "Pattern coverage": add one bullet for the
   sub-44 arbitrary `min-h-[NNpx]` + `<Badge asChild>` patterns
   (DOC-R4C15-01 scope).

**Acceptance:** audit green with ZERO new KNOWN_VIOLATIONS entries
(verified: tag-filter is the only sub-44 arbitrary min-h in scan
roots); chips render 44 px; wrap behavior unchanged (same px-3/gap-2);
full vitest green.

## Task 4 — DES-R4C15-04/05/06: small a11y hit-area + region-label fixes (LOW/High)

**Files:**
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`

**Changes:**
1. `admin-nav.tsx:37`: `min-h-10` → `min-h-11` (nine links; flex-wrap
   `gap-y-2` absorbs the 4 px).
2. `footer.tsx`: GitHub link gains `min-h-11` (already
   `flex items-center`); Admin link gains
   `inline-flex items-center min-h-11`. Desktop footer height
   unchanged (`md:h-24` &gt; content).
3. `admin/(protected)/error.tsx`: outer `<section aria-labelledby=…>`
   → plain `<div>` (layout wrapper); inner labelled `<section>` stays —
   single announced region, matching the public twin's structure.

**Acceptance:** eslint/typecheck green; touch-target audit counts
unchanged (links are not in FORBIDDEN's pattern domain — this is a
policy fix, not a gate fix); no visual regression (footer/admin-nav
spacing absorbed by existing flex gaps).

## Deferred this cycle
See `plan/plan-302-run4-cycle15-deferred.md` (PERF-R4C15-B,
OBS-R4C15-A, plus the standing-deferral re-audit including the
OBS-R4C14-A pickup note).

## Progress log
- Task 1 DONE — `cd873449` fix(error-shell): preserve OLED theme on the
  global error page. Helper + 5 new test cases + source-wiring lock,
  proven failing 1/9 pre-fix via git-stash check.
- Task 2 DONE — `660e0911` perf(map): sized + CDN-correct popup
  thumbnails. MarkerThumb mirrors R23-M1; imageSizes plumbed
  page→loader→client; map-thumb-wiring fixture proven failing 3/3
  pre-fix.
- Task 3 DONE — `5d0983d7` fix(a11y): 44px tag-filter chips + audit
  extension (Badge normalizer, 6 sub-44 arbitrary min-h patterns,
  6+6 fixtures, 2 multi-line Badge locks). Extended audit proven
  catching exactly the 2 pre-fix chip violations. OBS-R4C14-A /
  DOC-R4C14-03 closed (prose refreshed; size-variant patterns +
  exemptions kept as documented belt-and-braces). CLAUDE.md
  pattern-coverage updated.
- Task 4 DONE — `cfcaa866` fix(a11y): admin-nav min-h-11, footer link
  44px hit areas, admin error region label dedupe.
- Gates (all 8 green): eslint ✓ (exit 0), typecheck ✓ (exit 0),
  vitest ✓ 185 files / 1770 tests (baseline 184/1759 — +1 file,
  +11 tests), api-auth lint ✓, action-origin lint ✓,
  public-route-rate-limit lint ✓, production build ✓ (exit 0; sw.js
  stamped cfcaa866-p7, committed 5a94ccdb), playwright e2e ✓
  (20 passed / 2 skipped, 8.0m).
- GATE_FIXES note: zero pre-existing gate errors/warnings encountered
  this cycle (clean baseline); the 1+3+2 pre-fix-failing tests are new
  locks landed WITH their fixes, not gate regressions.
- DEPLOY: per-cycle-success — `npm run deploy` exit 0; host pulled
  8c39bac3, image rebuilt, `gallerykit-web` recreated and started;
  live probes `/en` 200, `/api/live` 200, `/sw.js` 200 with
  `SW_VERSION = 'cfcaa866-p7'` served in production.
