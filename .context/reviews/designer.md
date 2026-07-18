# Designer Review — Cycle 13/100

Reviewed HEAD: `8bd8999f`; live public application checked on 2026-07-18.

## Inventory and coverage

Inventoried public/admin App Router pages, layouts, loading/error/empty states,
components, Tailwind/global CSS, design tokens, EN/KO messages, route metadata,
Playwright tests, and touch-target/accessibility audits. Used the complete
agent-browser skill family against `https://gallery.atik.kr`: desktop 1440x900
and mobile 320x800, light/dark media, accessibility snapshots, DOM/computed
metrics, runtime errors/console, network requests, storage/cookies, search
dialog keyboard focus/Escape behavior, and full-page captures. The timeline had
zero horizontal overflow at 320px; search exposed a named dialog/combobox,
trapped focus, and returned focus to the opener after Escape.

## UX-C13-03 — Arbitrary four-digit query values become fake selected years

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed UI/data-validity issue with live evidence**
- Region: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-101` and
  the year scrubber/review link at `:166-203`.
- Evidence: the page treats any four ASCII digits as `requestedYear`, starts a
  database query for it, and chooses it without checking the authoritative
  `years` result. Live `/en/timeline?year=9999` returned HTTP 200 while the
  available scrubber contained only 2025; the main text included “9999 in
  Review” and “No photos found for 9999.”
- Concrete failure: a malformed/bookmarked/crawler URL presents a nonexistent
  archive selection and a prominent link to another empty archive page. It also
  runs an avoidable photo query for a year not present in the gallery, weakening
  the scrubber's affordance that its options define the archive.
- Suggested fix: after loading the authoritative year list, accept the request
  only when `years.includes(requestedYear)`; otherwise fall back to the newest
  available year. Keep the explicit-year query parallel only for syntactically
  valid values, then discard its result when the year is unavailable. Add a
  route/source behavior test for the membership fallback.

## Final sweep

No other confirmed information-architecture, WCAG 2.2, focus/keyboard,
touch-target, contrast, responsive, loading/empty/error, form-validation,
theme, EN/KO/RTL, LCP/CLS/INP, or perceived-performance defect survived the
source and live checks. The app currently supports EN/KO LTR locales only, so
RTL remains non-applicable rather than an observed regression.
