# Test Engineer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Test coverage, missing assertions, flakiness, contract drift.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Test-surface delta

Two test deltas in the diff:

1. `apps/web/src/__tests__/locale-path.test.ts` — substantially extended:
   - Replaced `it('honors a valid configured Open Graph locale override')` with `it('keeps route locale even when an admin-configured locale differs (F-6/F-16)')`.
   - Added `it('uses configured Open Graph locale only for unsupported route locales')`.
   - Extended `it('ignores unsupported Open Graph locale overrides')` with an additional case.

The new tests directly cover the `getOpenGraphLocale` precedence change. **Good coverage.**

2. No other tests changed.

## Coverage gaps for the new code paths

### TE1-LOW-01 — `getConcisePhotoAltText` underscore normalization untested (LOW, High confidence)

**File/region:** `apps/web/src/__tests__/photo-title.test.ts:70`.

**Why a problem:** The existing assertion is `expect(getConcisePhotoAltText({ title: 'IMG_0001.JPG', tag_names: 'Seoul,Night' }, 'Photo')).toBe('Seoul, Night')`. This does **not** exercise the new `.replace(/_/g, ' ')` branch added in `photo-title.ts:78`. None of the existing tag_names contain `_`.

**Failure scenario:** A future refactor removes the `.replace(/_/g, ' ')` and tests still pass.

**Suggested fix:** Add `expect(getConcisePhotoAltText({ title: 'IMG_0001.JPG', tag_names: 'Music_Festival,Night_Sky' }, 'Photo')).toBe('Music Festival, Night Sky')`.

**Confidence:** High.

### TE1-LOW-02 — `getPhotoDisplayTitleFromTagNames` underscore normalization untested in any consumer (LOW, High confidence)

**File/region:** `apps/web/src/components/home-client.tsx:160`.

**Why a problem:** Same as above for the display-title path. There is no unit test asserting that an underscored tag renders with spaces in the gallery card.

**Suggested fix:** If the underscore normalization is consolidated into `getPhotoDisplayTitleFromTagNames` (per CR1-LOW-01), one helper test covers both display title and alt text.

**Confidence:** High.

### TE1-LOW-03 — Hreflang alternate-language map untested (LOW, Medium confidence)

**File/region:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:95-99`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:91-95`.

**Why a problem:** The alternate-language map is built inline. No test exercises that all three required keys (`en`, `ko`, `x-default`) are emitted with the correct URLs. If a refactor accidentally drops one, no test catches it.

**Failure scenario:** A future PR removes `x-default` (e.g. someone considers it redundant). hreflang loses the no-locale fallback. Google may still index the page but cannot determine the default for unmatched locales.

**Suggested fix:** Add a unit test if extracting `buildHreflangAlternates(seo.url, path)` (per A1-LOW-01). Otherwise add a Playwright e2e assertion that `/en/<topic>` HTML contains `<link rel="alternate" hreflang="ko" ...>` etc.

**Confidence:** Medium.

### TE1-LOW-04 — Login form password-toggle behavior untested (LOW, Medium confidence)

**File/region:** `apps/web/src/app/[locale]/admin/login-form.tsx:73-94`.

**Why a problem:** No unit/component test exercises:
- The `aria-pressed` flips on click.
- The `aria-label` toggles between `showPassword` and `hidePassword`.
- The input `type` flips between `password` and `text`.
- The input value is preserved across the type flip.

**Failure scenario:** A refactor accidentally changes `aria-pressed` to `aria-checked` (wrong role) or breaks the input value preservation. Tests would not catch.

**Suggested fix:** Add a Playwright e2e test in `apps/web/e2e/admin.spec.ts` (already covers admin login) that types a password, toggles visibility, asserts the input has the expected `type`, then submits and confirms the password reaches the action.

**Confidence:** Medium.

### TE1-LOW-05 — Skip-link behavior to `<main>` not asserted (LOW, Low confidence)

**File/region:** `apps/web/src/app/[locale]/(public)/layout.tsx:18`, `apps/web/src/app/[locale]/not-found.tsx:26`.

**Why a problem:** The `tabIndex={-1}` change makes `<main>` programmatically focusable. No test asserts that activating the skip link moves focus to `<main>` (browsers handle this, but a regression e.g. removing `tabIndex={-1}` is silent).

**Failure scenario:** Quiet regression where skip link works visually but doesn't move focus.

**Suggested fix:** Playwright assertion: navigate to `/en/`, focus the skip link, press Enter, assert `document.activeElement.id === 'main-content'`.

**Confidence:** Low — browsers handle this correctly today even without the `tabIndex={-1}`. Defer.

## Existing test results

- `npm test --workspace=apps/web` → 60 files / 394 tests passing.
- `npm run lint:api-auth` → exit 0.
- `npm run lint:action-origin` → exit 0.

## Findings

**Zero new MEDIUM or HIGH findings.**

LOW: TE1-LOW-01 through TE1-LOW-05.

## Confidence

High.

## Recommendation

Schedule TE1-LOW-01 (underscore normalization unit test) — trivial to add, high value as a regression seatbelt for the consolidation refactor.
