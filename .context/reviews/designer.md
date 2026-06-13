# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** review-plan-fix cycle 6 (run-9 cycle-2 follow-on) · **HEAD:** `4c3d5924` · **Date:** 2026-06-13
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN at review start
**Method:** Static-source analysis with live audit gate execution (`npx vitest run touch-target-audit` → 13/13 pass).

**NET-NEW UI/UX FINDINGS THIS CYCLE: 1 (DES-C6-1, MED)**
**Prior-deferred DES-C5-2 / DES-C5-3 / DES-C5-4: RE-CONFIRMED OPEN, UNCHANGED — not re-escalated.**

---

## Cycle-5 fix verification (REQUESTED — re-read committed classNames, live gate run)

### AGG-C5-03 / DES-C5-1 — Three public inline `<Link>` recovery actions → **VERIFIED CLEAN** (commit `e7d19f4b`)

All three links confirmed to carry `inline-flex items-center min-h-11 px-2` at HEAD `4c3d5924`:

| File | Line | className (verbatim) |
|---|---|---|
| `components/topic-empty-state.tsx` | 18 | `"inline-flex items-center min-h-11 px-2 underline hover:text-primary"` |
| `components/home-client.tsx` | 434 | `"inline-flex items-center min-h-11 px-2 text-sm underline hover:text-primary"` |
| `app/[locale]/(public)/timeline/page.tsx` | 154 | `"inline-flex items-center min-h-11 px-2 text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"` |

Positive-assertion pin at `touch-target-audit.test.ts:1050` (`'public inline recovery <Link>s keep their min-h-11 tap area (AGG-C5-03)'`) passes live. The test asserts each file's first occurrence of `home.clearFilter` / the timeline recovery anchor carries `min-h-11` (or `min-h-[≥44px]`) — proven RED-on-revert per commit message.

### AGG-C5-02 — native `<select>` `(?<!max-)` lookbehind → **VERIFIED CLEAN** (commit `07a838d6`)

`touch-target-audit.test.ts:415,419` both carry `(?<!max-)` before `(?:h-8|h-9|h-10)` on the `<select>` FORBIDDEN patterns, mirroring the Button/button fix from `40a65aef`. The `<select className="max-h-10">` false-positive is closed.

### AGG-C5-01 — sidecar `flushBatch` orphan-cleanup test → **VERIFIED (commit `fad9c279`)**

`scripts/backfill-color-pipeline.ts` — `flushBatch` exported as `_flushBatchForTesting`. Test `backfill-color-pipeline-deleted-mid-reencode.test.ts` covers the `affectedRows===0` guard and orphan-cleanup path. Not a UI finding; recorded for completeness.

### image-manager KNOWN_VIOLATIONS 6→1 recount → **VERIFIED CLEAN** (commit `2637e5f2`)

`touch-target-audit.test.ts:183` entry is `'components/image-manager.tsx': 1` with documented rationale (`:177-182`). The single remaining violation is `batchAddButton:328` — a `size="sm"` Button that renders `min-h-11` at runtime via the Button primitive floor, kept as belt-and-braces against a future variant downgrade. Five prior budgeted items were retired.

### Touch-target gate — live run at HEAD `4c3d5924`

```
npx vitest run touch-target-audit → 13/13 pass (5.01s)
```

All 13 tests green, including the new AGG-C5-03 positive-assertion pin.

---

## Findings

Severity legend: **HIGH** = WCAG A/AA failure on public/shipped surface · **MED** = AA failure on admin surface, or AA/repo-floor failure on public surface · **LOW** = AAA / polish / consistency.

---

### DES-C6-1 — Two public back-navigation `<Link>`s render ~20 px tall — no `min-h-*` token, same bare-link gap as AGG-C5-03 — **MED** (confidence: High) — NEW

**Summary.** Two more public-route "back" navigation links share the exact failure pattern as the three links fixed in AGG-C5-03 — bare `text-sm flex items-center` with no `min-h-*`, rendering at their line-box height (~20 px). They are pre-existing, fell through the same deliberate audit gap, and were not caught when g/[key]/page.tsx was fixed (because its fix was done piecemeal). The audit's positive-assertion block (`test:1050`) pins only the three AGG-C5-03 links and does not cover these two.

**Evidence.**

| # | File | Line | className (verbatim) | Rendered tap height |
|---|---|---|---|---|
| a | `app/[locale]/(public)/s/[key]/page.tsx` | 105 | `"text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"` | ~**20 px** (text-sm line-box, no padding/min-h) |
| b | `app/[locale]/(public)/year/[year]/page.tsx` | 109 | `"text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"` | ~**20 px** (text-sm line-box, no padding/min-h) |

Neither carries any `h-*`, `min-h-*`, `py-*`, or `size-*` token. `text-sm` = `1.25rem` = `20 px` line height with Tailwind's default leading. That is:
- Below the repo's own **44 px floor** (WCAG 2.5.5 Target Size (Enhanced), AAA — the standard the repo explicitly claims to enforce repo-wide).
- Below **WCAG 2.5.8 Target Size (Minimum), AA = 24 px**.

**Why the audit doesn't catch them.** Both files are under `publicDir` in `SCAN_ROOTS` (confirmed). The `<Link>` FORBIDDEN patterns at `touch-target-audit.test.ts:424-466` require an *explicit* sub-44 sizing token (`h-8/h-9/h-10` or `min-h-[<44px]`) — the committed comment at `:430-432` states *"plain text links never trip."* These links carry **no sizing token at all**, so they pass the gate by the audit's own contract.

**Contrast between the fixed and unfixed pages.** The adjacent `g/[key]/page.tsx` (shared-group page) has two equivalent back-links that were correctly fixed — both carry `min-h-11`:
```
g/[key]/page.tsx:140  className="… flex items-center gap-1 min-h-11"
g/[key]/page.tsx:172  className="… flex items-center gap-1 min-h-11"
```
The `s/[key]` (shared single-photo) and `year/[year]` pages were not updated when `g/[key]` was fixed.

**User impact.** Both are public, mobile-first surfaces:
- `s/[key]` — the shared single-photo page; the back-link is the *only* navigation off the page (the PhotoViewer below it has no nav back to the gallery). A mobile user tapping a shared link has a 20 px escape target.
- `year/[year]` — the year-in-review page; the back-link routes to the timeline. The page is reached from timeline year-chips (which are correctly `h-11`), but the return path is undersized.

**Git origin.** `s/[key]` predates `g/[key]`'s fix (commit `c7100f1f` is the most recent s/[key] change, well before the g/[key] min-h-11 addition). `year/[year]` was introduced in `3070b1c7` without a min-h token.

**Fix.** Add `min-h-11` to both links — identical to the AGG-C5-03 fix pattern:

```tsx
// s/[key]/page.tsx:105
className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11"

// year/[year]/page.tsx:109
className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 min-h-11"
```

Also extend the `touch-target-audit.test.ts:1050` positive-assertion block to pin both new fixes, preventing silent regression — consistent with the approach taken for the three AGG-C5-03 links.

**Confidence:** High. ClassNames read verbatim from HEAD, line-box math straightforward (`text-sm` = 20 px), audit gap mechanism confirmed unchanged from the prior cycle review, g/[key] counterpart confirmed fixed, both files in SCAN_ROOTS and confirmed miss by the gate's own contract.

---

## Prior-deferred items — RE-CONFIRMED OPEN (no change, no re-escalation)

### DES-C5-2 — Nav theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible` ring — **LOW** — UNCHANGED

`nav-client.tsx:85,93,122,155,168` — re-read at HEAD. No `focus-visible:ring-*` on any of the five elements. No `focus-visible` lines in `nav-client.tsx` at all. UA-default outline still applies — not a hard WCAG 2.4.7 failure. Visually inconsistent with ~29 ring sites in the app and with shadcn Button's `focus-visible:ring-[3px]`. Status: **deferred** (plan-340, unchanged). Fix when UI-polish pass runs: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none`.

### DES-C5-3 — Color-pip `text-white/50` gamut suffix (thinnest margin) + histogram dotted-underline affordance — **LOW** — UNCHANGED

- `lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` — **5.15:1** (passes 4.5:1, thinnest margin; `text-[10px]`). Unchanged.
- `histogram.tsx:691` — `decoration-dotted decoration-muted-foreground/40` — ~2:1 decoration cue. Unchanged.

Status: **deferred** (plan-340, unchanged). Optional polish: `text-white/70` / `decoration-muted-foreground/70`.

### DES-C5-4 — Info-sidebar topic `<Badge>` renders raw slug — **LOW** — UNCHANGED

`photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` still renders the raw slug (e.g. `music-festival`) rather than `image.topic_label || image.topic`. The Back button at `:601` already uses the humanized form. Status: **deferred** (plan-340, unchanged). Fix: `{image.topic_label || image.topic}`.

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD `4c3d5924`)

- **`role="button"` divs** (the fourth blind-spot class probed this cycle): `image-zoom.tsx:359` (`role="button"`, `tabIndex={0}`, `aria-label`, `onKeyDown` Enter/Space, `focus-visible:outline-2`) and `upload-dropzone.tsx:410` (`role="button"`, conditional `tabIndex={-1}`, `aria-disabled`, `focus-visible:ring-2`). Both are correctly wired — not a gap.
- **DropdownMenuItem default height** (`ui/dropdown-menu.tsx:77`): default class `py-1.5` renders ~32 px. Every `<DropdownMenuItem>` usage in the codebase (`info-bottom-sheet.tsx:506,516`, `photo-viewer.tsx:1039,1049`) carries `h-auto min-h-11 py-2` override. Complete coverage.
- **Button primitive floor** (`ui/button.tsx:24-28`): `sm` → `min-h-11`, `default` → `min-h-11`, `icon` → `size-11`, `lg` → `min-h-12`. All size variants floor at ≥44 px. The `image-manager.tsx:328` audit hit (`size="sm"`, no override) renders `min-h-11` at runtime — the audit flags it as belt-and-braces against future variant downgrade, correctly documented.
- **g/[key] back-links** (both): `flex items-center gap-1 min-h-11` confirmed at `:140` and `:172`. The companion `s/[key]` and `year/[year]` pages are the gap (DES-C6-1 above).
- **Touch-target gate**: `npx vitest run touch-target-audit` → **13/13 pass** (live run at HEAD).
- **reduced-motion**, **aria-live**, **dialog focus-traps**, **forced-colors**, **color-detail badges**, **muted-foreground token** — all RE-CONFIRMED CLEAN (no changes to any of these surfaces in the cycle-5 commits; prior-cycle verification still holds).
- **Histogram `text-red-500` clip labels** (`histogram.tsx:671,674`): `#ef4444` = 3.76:1 on white (sub-4.5 borderline), 5.29:1 on dark card. Unchanged. Not raised — histogram lives on dark surfaces; light-mode fix deferred as before.

---

## Summary / priority for the plan

**1. DES-C6-1 (MED, NEW):** `s/[key]/page.tsx:105` ("View Gallery") and `year/[year]/page.tsx:109` ("Back to Timeline") — bare `text-sm flex items-center` links, ~20 px rendered height, no `min-h-*`. Below the repo's 44 px floor and WCAG 2.5.8 AA 24 px. Pre-existing pages that were missed when `g/[key]` was fixed. Both are public, mobile-first routes; `s/[key]` is the sole navigation escape from the shared-photo view. Fix = add `min-h-11` to both classNames + extend the positive-assertion pin block. Cheap: four-word className addition + two test entries.

**2. DES-C5-2 / DES-C5-3 / DES-C5-4 (LOW, all DEFERRED, UNCHANGED):** nav `focus-visible` ring; color-pip `text-white/50` thin margin; topic Badge raw slug. No change from prior cycle. Confirm deferred.
