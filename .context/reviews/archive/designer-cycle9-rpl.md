# designer — cycle 9 rpl (UI/UX review)

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## UI/UX presence detection

- Next.js 16 App Router with React 19, Tailwind CSS, Radix UI, shadcn/ui (confirmed in CLAUDE.md).
- `apps/web/src/components/` contains 25+ components.
- UI routes under `apps/web/src/app/[locale]/` including `(public)`, `admin/(protected)`.
- i18n via next-intl (en, ko).

Given the active subagent context, I cannot launch a fresh browser session via agent-browser. Reviewing via code + prior e2e artifacts + `.context/home-*.png` / `.context/photo-*.png` screenshots.

## Findings

### C9R-RPL-D01 — `PhotoViewer` original-format / original-file-size blocks never render on public routes [LOW / HIGH]
- Already captured as C9R-RPL-04 (code-reviewer angle). Design angle: the "Format" row is a useful datapoint in the photo info panel; admins see it in the admin dashboard but public viewers never do. Either:
  a. Make `original_format` / `original_file_size` public (not a privacy risk — format and file size are low-signal fields) and display to everyone.
  b. Keep the privacy posture and remove the dead UI branches from the public PhotoViewer.
- Recommend option (a): original format and file size are genuinely user-visible metadata that tools like Lightroom/Instagram show; omitting them from public is ambiguous privacy.
- Severity: LOW (feature polish, not UX blocker).

### C9R-RPL-D02 — Search dialog has no "X results" announcement for screen readers [LOW / MEDIUM]
- `search.tsx:207-251`.
- The results list has `role="listbox"` and `aria-activedescendant` — good.
- But there is no `aria-live` region announcing "N results found". Screen-reader users rely on the loading spinner visual to know "something is happening" but only the keyboard `aria-expanded={results.length > 0}` hints at results.
- Fix: add an off-screen `aria-live="polite"` region that updates when `results` changes: "{count} results found" / "no results".

### C9R-RPL-D03 — `FocusTrap` tests can't assert escape-key behavior on the search dialog with dynamic-import [LOW / MEDIUM]
- `lazy-focus-trap.tsx` is loaded via dynamic import; e2e tests cover the happy path but not the ESC-key close behavior while focus is inside a trapped result link. Currently relies on `window.addEventListener('keydown')` at `search.tsx:88-99` which runs before the trap. Cross-check passes visually but no formal test.
- Fix: add a Playwright test that opens the search, tabs to a result, presses Escape, and asserts the dialog closes + focus returns to the trigger button.

### C9R-RPL-D04 — `aria-activedescendant` points to IDs that only exist for visible results [LOW / MEDIUM]
- `search.tsx:177, 215`.
- When `results` changes rapidly (every 300ms debounce window), `activeIndex` might point to an index that no longer exists. `setActiveIndex(-1)` is called on input change (line 180), which resets the active index — good. But between the character typing and the new results arriving, the old `aria-activedescendant` can reference a stale ID. Browsers generally ignore dangling aria-activedescendant, but it's a spec smell.
- Fix: after results change, either set activeIndex to -1 (already done on input change) or null `aria-activedescendant` when `results.length === 0`.

### C9R-RPL-D05 — No announced timeout/error state when search fails [LOW / MEDIUM]
- `search.tsx:56-59`.
- On fetch error, `catch { setResults([]) }` silently wipes results. Users see "No results" even if the server action threw. Accessibility: no error announcement.
- Fix: differentiate "no results" from "error" and announce via aria-live when error path is hit.

## Positive confirmations

- WCAG 2.2 contrast: `text-muted-foreground` on `bg-card` — design tokens from shadcn/ui meet AA against their default palettes.
- Keyboard navigation: ArrowDown/ArrowUp handled (search.tsx:182-192). Escape closes dialog.
- Focus restoration to trigger button after dialog close (search.tsx:104-113) — correct pattern.
- `role="dialog"`, `aria-modal="true"`, `aria-label` on the search dialog — correct.
- Body scroll lock when search overlay is open (search.tsx:118-123) — correct UX.
- Mac/Windows platform detection for Cmd+K vs Ctrl+K hint (search.tsx:36-38) — good polish.
- i18n: all user-facing strings go through `t('...')`.
- Mobile-first responsive classes (`sm:` prefixed overrides).

## UX/accessibility priorities

1. C9R-RPL-D02 (aria-live result count) — a11y-spec alignment.
2. C9R-RPL-D05 (differentiate error vs empty) — small but meaningful.
3. C9R-RPL-D01 (public format/size display) — design question, not bug.
