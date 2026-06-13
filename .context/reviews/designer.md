# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** review-plan-fix cycle 5 (internally run-9 cycle-1 follow-on) · **HEAD:** `1dde9b1e` · **Date:** 2026-06-13
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN except `.context/reviews/*.md` (this fan-out)
**Method:** **STATIC-source analysis** (computed hex/px/ARIA evidence). NO live browser check — see methodology note.

## Methodology note — why source-only, not live

The dev server (`next dev`, port 3000) needs a reachable MySQL + env. Every public/admin route issues a DB query
during SSR, so `next dev` would 500 on first paint and `agent-browser` snapshots would capture only an error
boundary — adding noise, not evidence. As the prompt permits, I did the review from source (primary, acceptable).
Every finding below is backed by text-extractable evidence: exact `file:line`, the className/token, and **WCAG
contrast ratios computed in Python** from the actual CSS variables in `apps/web/src/app/[locale]/globals.css`
(HSL→sRGB→relative-luminance; opacity composites resolved over the actual tinted-background stack) and from the
Tailwind v3 named-color hex values. Box metrics and ARIA attributes are quoted verbatim. The repo's own
touch-target gate was run **live** (`npx vitest run touch-target-audit` → **12/12 pass**) to confirm a green baseline.

**Diff scope since prior cycle:** `git diff --stat ce0029aa..1dde9b1e` touches only 6 source files (sales-client,
image-queue, backfill-color-pipeline, p/[id]/page, (public)/page, + the new backfill test). The UI surface is
otherwise unchanged from the prior designer pass, so this review re-verifies the one design fix that landed and
then hunts NEW ground (inline-link tap targets — an audit blind spot the prior cycles never probed).

---

## Prior-cycle fix verification (REQUESTED — re-computed from on-disk tokens, NOT trusted on commit message)

### AGG-C4-03 / DES-A1 — sales `StatusBadge` amber/green light-mode contrast → **VERIFIED CLEAN** (commit `fd708c1e`)

My own prior-cycle finding. Re-read `sales-client.tsx:95,97` at HEAD:
```jsx
downloaded: { label: t.statusDownloaded, cls: 'text-green-700 dark:text-green-400', Icon: Check },   // :95
pending:    { label: t.statusPending,    cls: 'text-amber-700 dark:text-amber-400', Icon: Clock },   // :97
```
Recomputed against the white sales table (`bg-background` light):

| Status | Light token | Light on white | Verdict | Dark token | Dark on `--card` | Verdict |
|---|---|---|---|---|---|---|
| `downloaded` | green-700 `#15803d` | **5.02:1** | PASS (≥4.5) | green-400 | 11.42:1 | PASS |
| `pending` | amber-700 `#b45309` | **5.02:1** | PASS (≥4.5) | amber-400 | 11.92:1 | PASS |
| `refunded` | `text-destructive-text` | 6.46:1 | PASS | (token) | 7.20:1 | PASS |
| `expired` | `text-muted-foreground` | 6.03:1 | PASS | (token) | 7.76:1 | PASS |

All four statuses now clear 4.5:1 in light mode (the two failing ones — amber-600 3.19:1, green-600 3.30:1 — were
lifted to the `*-700` value). Triple-encoding (text + color + Icon, WCAG 1.4.1) preserved. **The one substantive
a11y finding from the prior cycle lands clean in both themes.** (Note: green-700 `#15803d` computes to 5.02:1, a
touch better than the 4.54:1 the prior designer note estimated — both clear AA comfortably.)

### Prior-prior fixes — RE-VERIFIED NOT REGRESSED (spot-recomputed at HEAD)

- **`--destructive-text` token (AGG-R8c3-04):** `globals.css:43,69,97` (HSL) + `:130,139,147` (oklch). Light 6.46:1 / dark 7.20:1 / oled 7.15:1. `grep "text-destructive\b"` minus `-foreground`/`-text` → **0 bare-text hits**; 20 sites on the token. Unchanged.
- **Alias-remove button 44px (AGG-R8c3-06):** `categories/topic-manager.tsx:333` still `min-h-11 min-w-11`. Audit scale-token patterns intact (the `max-` false-positive fix from `40a65aef` confirmed present — `FORBIDDEN` now anchors the bare `h`/`w` branches).
- **Amber dark-mode (AGG-R8c3-07/08):** histogram `:608` `text-amber-700 dark:text-amber-300` (5.02 / 13.80:1); settings `:259,306,338,674` `text-amber-700 dark:text-amber-400` (5.02 / 11.92:1). Unchanged.
- **Touch-target gate:** `npx vitest run touch-target-audit` → **12/12 pass** (live), including scale-token + multi-line normalizer + checkbox wrappers.

---

## Findings

Severity legend: **HIGH** = WCAG A/AA failure on a public/shipped surface · **MED** = AA failure on admin surface, or audit/coverage gap on a public surface · **LOW** = AAA / polish / consistency.

---

### DES-C5-1 — Inline `<Link>` "clear filter" / "year-in-review" controls render ~20 px tall (below the 44 px floor the repo enforces); they fall in the touch-target audit's DELIBERATE bare-link gap (the `<Link>`/`<a>` patterns flag only an explicit `h-8/h-9/h-10`/`min-h-[<44px]` downsize, by design NOT a link with no sizing token) — **MED** (confidence: High) — NEW

**The audit gap — deliberate, not an oversight (verified at `touch-target-audit.test.ts:424-466`).** The audit DOES scan `<Link>` and `<a>` (8 patterns, added prior-cycle AGG-R5C3-06 / CRT-R5C3-01). BUT every one is shaped `<Link …(?!…h-1[12]/min-h-1[12]/size-1[12]…)…className=…\b(?:h-8|h-9|h-10)\b` or `…min-h-[<44px]` — i.e. it only fires when the link carries an **explicit sub-44 sizing token**. The committed comment at `:430-432` states the rationale verbatim: *"The lookahead ALSO requires a sizing className present, so sr-only skip links (no h-/min-h token) and **plain text links never trip.**"* So the audit catches a *regression* (a previously-sized link downsized to `h-8`) but, by explicit design, **cannot catch a bare inline link that never had a height token** — which is exactly the shape of all three findings below (none carries any `h-*`/`min-h-*`). They render at their line-box height, sub-44, with a green gate. `KNOWN_VIOLATIONS` lists neither `topic-empty-state.tsx` nor `home-client.tsx` (both default to 0 expected) — and correctly so under the audit's own contract, because bare links are out of scope. The finding is that three *real* recovery-action links sit in that intentional gap.

**Three concrete sub-44 inline links at HEAD** (all PUBLIC surfaces):

| # | Where | className (verbatim) | Rendered tap height |
|---|---|---|---|
| a | `components/topic-empty-state.tsx:18` | `"underline hover:text-primary"` (inherits parent `text-muted-foreground`, base 16 px) | ~**24 px** (line-box, no padding/min-h) |
| b | `components/home-client.tsx:434` | `"text-sm underline hover:text-primary"` | ~**20 px** (text-sm line-box 1.25rem) |
| c | `app/[locale]/(public)/timeline/page.tsx:152-154` | `"text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"` (year-in-review link) | ~**20 px** |

A `text-sm` inline link with no `py-*`/`min-h-*` has a line-box height of `1.25rem = 20 px`. That is below the repo's documented **44 px floor (WCAG 2.5.5 Target Size (Enhanced), AAA)** — which the repo explicitly claims to enforce repo-wide ("all interactive elements … must present a tappable area of at least 44×44 px") — and also below the **WCAG 2.5.8 Target Size (Minimum), AA = 24 px** floor for items b and c. Item a (~24 px) is at the 2.5.8 AA edge but still fails the repo's own 44 px AAA standard.

**Why these specifically matter (not generic link nitpicking).** Each is the *sole recovery action* in an empty/filtered state — the user has zero results and this link is the only way out:
- (a) topic page "no images / clear filter" — the only escape from an over-filtered topic.
- (b) home "no results matching tags / clear filter" — same, on the highest-traffic public route.
- (c) timeline "year in review" — a primary cross-navigation on a public page.

These are mobile-relevant (the gallery is masonry/touch-first) and a 20 px target is a documented fat-finger miss risk — exactly the failure mode the 44 px gate exists to prevent. By contrast the app gets this right elsewhere: timeline **year chips** at `timeline/page.tsx:131` use `h-11 min-w-[44px]`, footer links `min-h-11`, on-this-day links `min-h-[44px]`, search result rows `p-2` + `w-12 h-12` thumb. The three above are the outliers that slipped through precisely because the audit doesn't scan `<Link>`.

**Fix (two parts):**
1. *Close the immediate gap* — add `inline-flex items-center min-h-11` (and `px-2` for a comfortable horizontal target) to the three links, matching the `min-h-[44px]` pattern footer/on-this-day already use. e.g. `topic-empty-state.tsx:18` → `className="inline-flex items-center min-h-11 px-2 underline hover:text-primary"`.
2. *Close the gap durably* — this is intentionally harder than the Button scan and the prior cycle punted on it for a reason: a "bare link has no height token ⇒ flag it" rule would false-positive every link that legitimately inherits ≥44 px from a sized flex parent (the search result row, the nav topic chips before they got `min-h-[44px]`, etc.). The pragmatic options, cheapest first: (a) fix the three links per part 1 and accept the documented bare-link gap as-is (the audit still guards against *downsize* regressions, which is its stated scope); (b) add the three fixed links to a small allowlist-style positive assertion so a future drop of their `min-h-11` is caught; (c) a heuristic scan that flags interactive `<Link>`/`<a>` whose className has NO sizing token AND is NOT inside a `flex`/`grid` parent with a height — high engineering cost, deferred. Part 1 alone resolves the live a11y defect; the audit hardening is a separate, optional follow-up.

**Confidence:** High on the mechanism (className verbatim, line-box math, the audit's `<Link>`/`<a>` patterns at `:424-466` inspected — they require an explicit sub-44 sizing token, and the committed comment confirms bare links are out of scope by design) and on "not previously recorded" (grepped `plan-338-run9-cycle1-deferred.md`: no link/tap/empty-state item). Severity is MED not HIGH because (i) WCAG 2.5.5 is AAA, and the repo's 44 px is a self-imposed standard above the AA 2.5.8 floor; items b/c also fail 2.5.8 AA (20 < 24) but on a recovery link, not a primary task flow; (ii) all three are keyboard- and pointer-reachable with visible hover/underline affordance — the defect is target *size*, not operability.

---

### DES-C5-2 — Nav theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible` ring — **LOW** (confidence: High) — RE-CONFIRMED OPEN (prior DES-5 / plan-336 Deferred-6)

**Where:** `components/nav-client.tsx:85` (title `<Link>`), `:93` (mobile-expand `<button>`), `:122` (topic `<Link>`s), `:155` (theme `<button>`), `:168` (locale `<button>`).

**Evidence (re-read at HEAD):** all five carry only `hover:bg-accent` / `hover:text-foreground hover:bg-muted/50` + `min-h-[44px]`/`min-w-[44px]`, and **no** `focus-visible:ring-*`. There is no global `:focus-visible` base rule in `globals.css` and no custom ring in `tailwind.config.ts`. The app uses `focus-visible:ring` at ~29 sites and shadcn `<Button>` ships `focus-visible:ring-[3px]` — these nav controls are the outliers. They do **not** set `outline-none`, so the UA-default outline still applies — so this is *not* a hard WCAG 2.4.7 failure — but it is visually inconsistent and the thin default outline is easy to miss against the translucent `bg-background/20` nav, which is top-of-page chrome on every route.

**Status:** RECORDED deferred (prior DES-5, plan-336 Deferred-6). Re-confirmed present at HEAD, **not** re-escalated. Fix when the UI-polish pass runs: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the three `<button>`s and two `<Link>`s to match the rest of the app.

---

### DES-C5-3 — Color-pip `text-white/50` gamut suffix (thinnest margin) + histogram dotted-underline affordance is faint — **LOW** (confidence: Medium) — RE-CONFIRMED OPEN (prior DES-6 / plan-336 Deferred-6)

**Where:**
- `components/lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` inside a `bg-white/10` chip on the `bg-black/80` panel. white@50% over (white@10% over near-black) = **5.15:1** — *passes* 4.5:1 but is the thinnest color-UI margin, text is `text-[10px]`.
- `components/histogram.tsx:691` — key-type tooltip trigger `<span … className="… cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">`. The `/40` decoration is ~2:1 — the "has a tooltip" cue is barely visible (the span *text* itself, `text-muted-foreground`, is fine).

**Status:** RECORDED deferred (plan-336 Deferred-6); both pass text contrast, the weaker is the affordance cue. Re-confirmed present. Optional polish: suffix → `text-white/70` (~9:1), underline → `decoration-muted-foreground/70`.

---

### DES-C5-4 — Info-sidebar topic `<Badge>` renders the raw slug, not the humanized label — content consistency — **LOW** (confidence: High) — RE-CONFIRMED OPEN (prior DES-7 / plan-336 Deferred-6)

**Where:** `components/photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` prints the **raw slug** (e.g. `music-festival`). In the SAME info card the Back button (`:601`) uses `image.topic_label || image.topic` (humanized) and tag chips (`:836`) run through `humanizeTagLabel(tag.name)`. So a viewer sees a hyphenated lowercase topic slug between a humanized Back-button label and humanized tag chips.

**Status:** RECORDED deferred (plan-336 Deferred-6; cosmetic). Re-confirmed present. Fix: render `image.topic_label || image.topic` in the Badge (the value the Back button already uses).

---

## Sub-threshold observations (no finding — recorded for coverage)

- **Histogram clip labels `text-red-500` (`histogram.tsx:671,674`):** `#ef4444` = **3.76:1 on white** (below 4.5 small-text) but **5.29:1 on the dark `--card`** where the histogram lives (lightbox/sidebar are dark-surface-heavy). Short bold numeric percentages, borderline. Prior cycle noted this; unchanged. If a future pass touches it, add a light-mode `text-red-600` (4.55:1). Not raised because the histogram's primary surfaces are dark.
- **`focus:ring` vs `focus-visible:ring` (5 sites):** `tag-input.tsx:183`, `upload-dropzone.tsx:373`, `topic-manager.tsx:333`, plus shadcn `ui/dialog.tsx`/`ui/sheet.tsx` close buttons use the older `focus:ring` form (ring also shows on mouse-click — noisier than the app's dominant `focus-visible:`). Not a WCAG failure (focus IS indicated). Cheap consistency nit.
- **Upload remove-X icon over photo thumbnail (`upload-dropzone.tsx:475`, WCAG 1.4.11):** default-state `<X>` inherits `text-foreground` over `bg-background/50` over an arbitrary photo — scrim mitigates but doesn't *guarantee* 3:1 against a mid-tone photo; solid `hover:bg-destructive` rescues hover/focus. Admin-only, small icon, mitigation in place — recorded, not raised.
- **on-this-day "View Timeline" link (`on-this-day-widget.tsx:42`):** `text-xs text-muted-foreground` = **6.03:1 on white** (PASS) and carries `min-h-[44px] flex items-center` (tap target PASS). Verified clean — listed only because it is a text-xs muted link that looked suspicious; it is not a finding.

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD `1dde9b1e`)

- **Settings page color banners (BOTH themes, recomputed this cycle):** the blue backfill-trigger card + amber backfill-required status are clean. `settings-client.tsx:277` blue-900 on `bg-blue-50/60` = **9.85:1** light / blue-200 on `bg-blue-950/20` = 13.48:1 dark; `:279` blue-800/80 (opacity-composited) = **5.12:1** light / 8.84:1 dark; `:303` blue-900/90 = 7.54:1 / 11.01:1; `:456` blue-800 = 8.29:1 / 10.63:1; `:259` amber-800 on `bg-amber-50/60` = **6.94:1** light / 13.35:1 dark; nested `:306,338` amber-400 = 11.48:1 dark. **All ≥ 5:1 in both modes — no opacity-composite failure.** `role="status"` correctly used (advisory, not blocking) on the dynamic backfill banners.
- **`reduced-motion` — double-covered (CSS blanket + JS gates):** `globals.css:291` blanket `animation-duration/transition-duration: 0.01ms !important` on `*`; AND JS gates at `image-zoom.tsx:48`, `home-client.tsx:443` (scroll behavior), `lightbox.tsx:93,105,470,526` (Ken Burns `animation` only applied when `!shouldReduceMotion`), `photo-viewer.tsx:88,774,780,782` (framer-motion `useReducedMotion` → `duration:0` / `initial:false`). Ken Burns cannot animate under reduced-motion from either layer.
- **`aria-live` regions:** photo-navigation `:247` (`polite atomic` photo-nav status), load-more `:150` (`polite atomic` loading/loaded/no-more), lightbox `:461` (`polite atomic` slideshow on). Toasts via `ui/sonner`. All present.
- **Dialogs/modals:** every dialog (image-manager, bulk-edit-dialog, admin-user-manager, db/page, topic-manager, tag-manager, tokens-client, sales-client) uses Radix `ui/dialog`/`ui/alert-dialog` → built-in focus trap + `aria-modal` + Escape + focus restoration. The 3 custom overlays (lightbox, search, info-bottom-sheet) carry manual `FocusTrap` + `role="dialog" aria-modal`.
- **Touch targets — non-link interactive surface:** photo-navigation buttons `h-12 w-12` + `aria-label`; load-more `h-11`; settings backfill button `h-11`; nav controls `min-h-[44px] min-w-[44px]`; footer links `min-h-11`; on-this-day links `min-h-[44px]`; timeline year chips `h-11 min-w-[44px]`; search result rows `p-2` + 48 px thumb. The ONE gap is inline `<Link>` recovery actions (DES-C5-1).
- **Empty/loading/error states:** `topic-empty-state.tsx`, `home-client.tsx:428` (icon + hint + clear link), `load-more` (spinner + sr-only status), `admin/(protected)/error.tsx` + `loading.tsx`, `[locale]/error.tsx`, `not-found.tsx` all present with correct ARIA and localized strings.
- **i18n:** no hardcoded English in JSX across the components touched/flagged (all via `t()`); "GitHub" in `footer.tsx:50` is a brand name (acceptable). `layout.tsx:99` `dir="ltr"` explicit (en/ko both LTR — correct).
- **Forced-colors (Windows HC):** `globals.css:203-220` (hdr/gamut/pip badges), `:310-321` (masonry card text overlays pinned to Canvas/CanvasText). Present.
- **Color-detail badges (purple/amber gamut chips):** `color-details-section.tsx:338,352,383`, `home-client.tsx:387`, `info-bottom-sheet.tsx:273`, `image-manager.tsx:522` all use `bg-purple-200 text-purple-900` (light) / `dark:bg-purple-900/40 dark:text-purple-200` (dark) — both well above 4.5:1; gamut chips gated on `data-display-gamut` so they only show on capable displays.
- **`muted-foreground` token:** light 40% L = 6.03:1 on white (PASS, the F-11 bump held); dark 64.9% L = 7.76:1; oled = 5.7:1 on `#000`. No regression.

---

## Summary / priority for the plan

1. **DES-C5-1 (MED, NEW):** three public-surface inline `<Link>` recovery actions (topic/home "clear filter", timeline "year in review") render ~20 px tall — below the repo's 44 px floor and, for two of them, below the WCAG 2.5.8 AA 24 px floor. They sit in the touch-target audit's **deliberate bare-link gap**: the `<Link>`/`<a>` patterns (`touch-target-audit.test.ts:424-466`) flag only an *explicit* sub-44 sizing token (`h-8/h-9/h-10`, `min-h-[<44px]`) — the committed comment states "plain text links never trip" — so a link with no height token at all is out of scope by design and ships green. Fix = add `inline-flex items-center min-h-11 px-2` to the three links (cheap, immediate; resolves the live defect); the audit-hardening for bare links is a harder, optional follow-up (a naive rule would false-positive links that inherit height from sized flex parents). **This is the one substantive, currently-open a11y finding this pass.**
2. **DES-C5-2/3/4 (LOW, all RE-CONFIRMED OPEN = prior DES-5/6/7, plan-336 Deferred-6):** nav `focus-visible` ring; color-pip `text-white/50` thin margin + faint histogram underline; info-sidebar topic Badge raw slug. All present at HEAD, all already recorded as deferred polish — listed to confirm no regression / no silent drop. No re-escalation.

**Net:** the prior-cycle design fix (sales `StatusBadge` light-mode amber/green) is **VERIFIED CLEAN with re-computed ratios ≥ threshold in both themes** (5.02:1 each). The settings color banners — the largest tinted-background opacity-composite surface in the app — were recomputed in both themes this cycle and are all ≥ 5:1. The only newly-actionable item is DES-C5-1, the inline-link tap-target gap exposed by probing the one interactive-element class the touch-target audit has never covered. Everything else is the previously-deferred LOW polish trio, confirmed unchanged. The a11y surface is at honest convergence apart from this one audit-coverage gap.

NET-NEW UI/UX FINDINGS THIS CYCLE: 1
