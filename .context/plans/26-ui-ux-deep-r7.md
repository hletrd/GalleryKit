# Plan 26: UI/UX Deep Fixes — Round 7 ✅ DONE

**Priority:** HIGH (items 1-3), MEDIUM (items 4-7), LOW (items 8-10)
**Estimated effort:** 4-5 hours
**Sources:** UI/UX Deep Review 2026-04-18 (Playwright-verified)
**Status:** COMPLETE
**Completed:** 2026-04-18

---

## Ralph progress summary

- Verified against live runtime with Playwright-backed checks and screenshots in `.context/reviews/ui-ux-artifacts-2026-04-18/`
- `npm test --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅
- `lsp_diagnostics_directory apps/web` ✅ (0 errors)

The current Ralph iteration confirmed that several items from this plan had already been implemented in the working tree before execution started, but the plan document had not been updated. The remaining gaps were completed in this iteration and the plan is now closed out.

---

## 1. Dev-specific CSP relaxation so `next dev` works with interactivity ✅ VERIFIED
**Source:** UI/UX Review #2
**Files:** `apps/web/next.config.ts`
**Confidence:** HIGH

**Outcome:** Already present in the working tree and verified during this Ralph run. Development CSP now allows hydration/HMR while production keeps the stricter policy.

**Verification evidence:**
- A fresh `next dev` session no longer emitted the earlier wall of CSP script-block errors.
- Interactive controls were exercised with Playwright using the normal runtime.

---

## 2. Admin routes use an admin-only shell without public nav/footer ✅ VERIFIED
**Source:** UI/UX Review #3
**Files:** `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`
**Confidence:** HIGH

**Outcome:** Already present in the working tree and verified during this Ralph run. Public chrome is now isolated under the `(public)` route group while admin routes use their own layout shell.

**Verification evidence:**
- Route group split confirmed by code inspection.
- Admin screenshots show a dedicated admin shell rather than the original double-wrapped layout behavior.

---

## 3. Persistent mobile gallery captions ✅ COMPLETED
**Source:** UI/UX Review #4
**Files:** `apps/web/src/components/home-client.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
**Confidence:** HIGH

**Outcome:** Mobile cards now expose persistent context at the top of the image instead of relying on hover-only overlays. Shared-group mobile cards now do the same.

**Verification evidence:**
- `mobile-home-ko-current.png`
- `mobile-nav-expanded-ko-hydrated.png`

---

## 4. Shared viewer context polish ✅ COMPLETED
**Source:** UI/UX Review #5
**Files:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/components/photo-viewer.tsx`
**Confidence:** HIGH

**Outcome:** The duplicate topic back-link suppression was already present via `isSharedView`. This iteration added explicit shared-view context headers so recipients land on a page with immediate title/description context instead of a bare image canvas.

**Verification evidence:**
- `desktop-shared-photo-ko-current.png`
- shared-group viewer checks through the Playwright artifact set

---

## 5. `aria-label` coverage for admin icon buttons ✅ VERIFIED
**Source:** UI/UX Review #6
**Files:** `topic-manager.tsx`, `tag-manager.tsx`, `admin-user-manager.tsx`, `image-manager.tsx`
**Confidence:** HIGH

**Outcome:** Already present in the working tree and verified again during this Ralph run.

**Verification evidence:**
- `ui-ux-current-checks.json` shows icon-only admin buttons exposing labels such as `뒤로`, `편집`, and `삭제`.

---

## 6. Mobile search overlay touch adaptation ✅ VERIFIED
**Source:** UI/UX Review #7
**Files:** `apps/web/src/components/search.tsx`
**Confidence:** HIGH

**Outcome:** Already present in the working tree and re-verified here:
- mobile shortcut footer hidden (`hidden sm:block`)
- result subtitles use a readable transformed topic label rather than the raw slug

**Verification evidence:**
- `mobile-search-overlay-ko-hydrated.png`
- `search.tsx` code inspection

---

## 7. Localized global fatal error page ✅ COMPLETED
**Source:** UI/UX Review #9
**Files:** `apps/web/src/app/global-error.tsx`
**Confidence:** HIGH

**Outcome:** Replaced the hardcoded English/inline-style fatal error page with a localized client-side variant that prefers the route locale from `window.location.pathname` and falls back to `navigator.language`, while using the app’s visual language.

---

## 8. Replace placeholder site config defaults ✅ COMPLETED
**Source:** UI/UX Review #10
**Files:** `apps/web/src/site-config.json`
**Confidence:** HIGH

**Outcome:** Placeholder runtime defaults are now fully replaced with sensible GalleryKit demo values, including non-placeholder `url` and `parent_url` values.

---

## 9. Histogram readability and i18n labels ✅ COMPLETED
**Source:** UI/UX Review #11
**Files:** `apps/web/src/components/histogram.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`
**Confidence:** HIGH

**Outcome:** Histogram labels now flow through translations instead of hardcoded English mode names, while retaining the improved readable 240×120 presentation.

---

## 10. Admin secondary screen polish ✅ VERIFIED
**Source:** UI/UX Review #8
**Files:** `password-client.tsx`, `password-form.tsx`, `users/page.tsx`, `categories/page.tsx`, `tags/page.tsx`
**Confidence:** MEDIUM

**Outcome:** The card-based password screen, constrained admin content widths, and denser page structure were already present in the working tree and were re-verified during this Ralph run.

---

## Final verification notes

- This plan is now fully closed.
- 2026-04-18 Ralph follow-up re-verified the R7 UI/UX fixes while closing the last related PRD-level correctness gaps elsewhere in the repository; no additional `.context/plans` follow-up work remains open.
- Remaining UI review findings that are **not explicitly part of this plan document** should be treated as separate follow-up work rather than open items in Plan 26.
