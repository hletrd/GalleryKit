# Verifier — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Evidence, repeatable claims, contradictions to other reviewers.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Plan-trail verification

Plans referenced by the 11 fix commits' designer-finding IDs (F-1 through F-23) are in `.context/plans/` per the run context. The diff's commit messages map cleanly:

| Commit | Finding(s) | Type |
|---|---|---|
| `e3c1dd3` | F-1, F-5 (tag pills + slug humanization) | UI/UX |
| `4327ba9` | F-2 (mobile expand toggle 44x44) | UI/UX |
| `3f78a4b` | F-3, F-21 (search trigger + close 44x44) | UI/UX |
| `cbe0e27` | F-6, F-16 (route locale OG precedence) | SEO |
| `e0bf06f` | F-4, F-7, F-22 (not-found shell + skip link) | UI/A11y |
| `4f5bcba` | F-8 (image-zoom outline) | A11y |
| `2b328b5` | F-9, F-10, F-20, F-23 (mobile photo viewer) | UI/UX |
| `d720b62` | F-11 (muted-foreground contrast) | A11y |
| `6e01a8a` | F-12, F-13 (login labels + password toggle) | A11y/UX |
| `d73e730` | F-15, F-18 (2xl masonry + alt text) | UI/A11y |
| `8d351f5` | F-17 (hreflang) | SEO |

All 23 designer findings are addressed with at least one corresponding code change. Verified by F-* trace via `Grep`.

## Code-vs-claim verification

- **F-2 (44x44 mobile expand toggle):** `nav-client.tsx:89` has `min-w-[44px] min-h-[44px] flex items-center justify-center`. Confirmed.
- **F-3 (search trigger 44x44):** `search.tsx:160` has `h-11 w-11`. Confirmed.
- **F-21 (search close 44x44):** `search.tsx:228` has `h-11 w-11 shrink-0`. Confirmed.
- **F-6/F-16 (route locale wins):** `locale-path.ts:64-65` has `if (isSupportedLocale(locale)) return OPEN_GRAPH_LOCALE_BY_LOCALE[locale];`. Confirmed.
- **F-8 (focus-visible outline):** `image-zoom.tsx:125` has `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400`. Confirmed.
- **F-11 (muted-foreground):** `globals.css:33` has `--muted-foreground: 240 3.8% 40%`. Confirmed.
- **F-12 (visible labels):** `login-form.tsx:48,63` show `<label>` with `text-sm font-medium block`. Confirmed.
- **F-13 (password toggle):** `login-form.tsx:81-94` show the visibility toggle button with `aria-label`, `aria-pressed`. Confirmed.
- **F-17 (hreflang alternates):** `(public)/[topic]/page.tsx:95-99` and `(public)/p/[id]/page.tsx:91-95` both build `alternateLanguages = { en, ko, 'x-default' }`. Confirmed.
- **F-15 (2xl:columns-5):** `home-client.tsx:155` has `2xl:columns-5`. Confirmed.

## Cross-reviewer agreement

| Finding | Reviewers agreeing | Severity |
|---|---|---|
| Underscore normalization scattered (CR1-LOW-01/-02, CRIT, A1-INFO-02) | code-reviewer, critic, architect | LOW |
| `2xl:columns-5` JS mismatch (P1-LOW-02, F-15 critique) | perf, critic | LOW |
| Skeleton-shimmer issues (P1-LOW-01, F-23 critique) | perf, critic | LOW |
| hreflang not iterating LOCALES (A1-LOW-01, F-17 critique) | architect, critic | LOW |
| `focus-visible:ring-*` vs `outline-*` inconsistency (F-8 critique) | critic | LOW |
| Login `aria-pressed` + dynamic label may double-cue (F-12/F-13 critique, S1-LOW-02) | security, critic | LOW |
| Photo container 40vh too small in landscape mobile (F-10 critique) | critic | LOW |

No reviewer surfaces a MEDIUM or HIGH finding. The strongest cross-agent signal is **underscore normalization scattered** and **column-count mismatch**, both of which are mechanical fixes.

## Findings

**Zero new MEDIUM or HIGH findings.**

### LOW (verified)

- **V1-LOW-01** (cross-cite of CR1-LOW-01): underscore normalization should consolidate into `getPhotoDisplayTitleFromTagNames`. Three reviewer agreement. **Confidence: High.**
- **V1-LOW-02** (cross-cite of P1-LOW-02): `useColumnCount` JS thresholds don't mirror the new `2xl:columns-5` CSS breakpoint. Two reviewer agreement. **Confidence: High.**
- **V1-LOW-03** (cross-cite of P1-LOW-01): `skeleton-shimmer` runs forever, including in dark mode where the gradient is nearly invisible. Two reviewer agreement. **Confidence: High.**
- **V1-LOW-04** (cross-cite of A1-LOW-01): `alternateLanguages` should iterate `LOCALES` constant for forward-compat. Two reviewer agreement. **Confidence: High.**

## Gate verification

Run during this cycle:

- `npm run lint --workspace=apps/web` → exit 0
- `npm run lint:api-auth --workspace=apps/web` → exit 0
- `npm run lint:action-origin --workspace=apps/web` → exit 0
- `npm test --workspace=apps/web` → 60 files / 394 tests passed
- `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0
- `npm run build --workspace=apps/web` → exit 0, all routes compiled

E2E and final lint:* re-run with whole-repo gate executions covered in Prompt 3.

## Confidence

High.

## Recommendation

Schedule the four LOW items into a single small "cycle 1 fresh polish" plan. Quality gates green; deploy can proceed.
