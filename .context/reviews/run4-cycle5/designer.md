# Designer — Run-4 Cycle 5

Angle: UI/UX, accessibility, loading/error states, i18n surface
consistency. Method note: this cycle's designer pass is static-analysis
driven (component source + computed class audit + the repo's own
axe/touch-target fixtures); the Playwright e2e gate in PROMPT 3 provides
the functional browser verification for the affected public routes. No
multimodal screenshot claims are made — all findings cite selectors and
source lines.

## Inventory
- Public gallery flow: `home-client.tsx` (masonry, scroll restore, LCP
  priority logic), `load-more.tsx` (sentinel + button + aria-live),
  `optimistic-image.tsx` (spot), `c/[slug]` page composition.
- Cycle-4-touched UI: `tokens-client.tsx` (Enter guard), failed-image
  panel posture (unchanged this cycle).
- Widgets less recently reviewed: `on-this-day-widget.tsx`,
  `info-bottom-sheet.tsx` (spot), `search.tsx` (spot).
- i18n: `messages/en.json` / `ko.json` parity for the strings my findings
  touch; error-message localization posture at action boundaries.
- Touch-target fixture: `touch-target-audit.test.ts` green in baseline
  (44 px floor enforced repo-wide).

## Findings

### UX facet of COR-R4C5-01 — smart-collection visitors see the gallery repeat itself — MED (shared root cause) / Confidence: High
- Concrete visitor experience on `/c/{slug}` for a >30-photo collection:
  scroll to the sentinel → the SAME first 30 photos append again (and
  again, on every subsequent intersection). The photo count header
  (`totalCount`) says e.g. "61 photos" while the grid shows endless
  repeats of 30; duplicate React keys also break the masonry's reorder
  memo guarantees. The `aria-live` status region dutifully announces
  "Loaded 30 more photos" each time — actively asserting false progress
  to screen-reader users. Root cause + fix are COR-R4C5-01 (code file);
  no separate design fix needed, but the fix MUST restore truthful
  `aria-live` semantics automatically (it announces from the real page).

### I18N-R4C5-03 — English-only error strings cross localized action boundaries — LOW / Confidence: High
- `actions/collections.ts:33,78`: smart-collection validation failures
  return `e.message` (e.g. "between predicate requires lo and hi",
  "unknown column: …") verbatim. Any future admin UI (and any current
  caller) would toast English at Korean admins — the exact drift class
  R4C4-05 just closed on the tokens page two lines from a localized
  `t('unauthorized')`.
- `actions/embeddings.ts:112-113`: `message: err.message` — same class,
  plus internals exposure (see security file).
- Posture fix (matches C6-RPF-03 / R4C4-05 lineage): localized generic
  key across the boundary (`invalidCollectionQuery` /
  `backfillFailed`-class), detail to server logs. EN+KO keys added
  together (key-parity discipline).

## Verified clean
- `on-this-day-widget.tsx`: `<aside aria-label>`, list semantics,
  `min-h-[44px]` rows, per-item aria-labels — exemplary.
- `load-more.tsx`: button fallback inside the sentinel (keyboard +
  no-IO environments), `h-11` target, disabled-while-loading, `sr-only`
  polite live region, maintenance-toast cooldown to avoid toast spam.
- `tokens-client.tsx` post-R4C4: Enter guard + preventDefault verified in
  source; sibling parity (image-manager / topic-manager) confirmed by the
  contract test.
- Tokens-page strings: all 22 `lrToken.*` keys present in BOTH locales
  (cycle-4 parity check still holds after the 8 new error keys).
- No new touch-target violations introduced in cycle 4 (fixture green at
  baseline; the only UI diff was the tokens Enter handler).
