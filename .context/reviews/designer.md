# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** post-run-8-cycle-3 fix verification pass · **HEAD:** `ce0029aa` · **Date:** 2026-06-13
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN except `.context/reviews/*.md` (other agents)
**Method:** **STATIC-source analysis** (computed hex/px/ARIA evidence). NO live browser check — see methodology note.

## Methodology note — why static, not live

The dev server (`next dev`, port 3000) needs a reachable MySQL. In this sandbox **port 3306 is CLOSED**
(verified: `/dev/tcp/127.0.0.1/3306` refuses; no `timeout` binary), and every public/admin route issues a DB
query during SSR, so `next dev` would 500 on first paint and `agent-browser` snapshots would capture only an
error boundary. I therefore did **not** run the agent-browser skills. Every finding below is backed by
text-extractable evidence: exact `file:line`, the className/token, and **WCAG contrast ratios computed in
Python from the actual CSS variables** in `apps/web/src/app/[locale]/globals.css` (HSL→sRGB→relative-luminance
for both the HSL fallbacks and the `@supports (oklch)` overrides) and from the Tailwind named-color hex values.
Box metrics and ARIA attributes are quoted verbatim. The repo's own touch-target gate was run live
(`vitest run touch-target-audit` → **12/12 pass**) to confirm a green baseline.

---

## Prior-cycle fix verification (REQUESTED — all 3 fixes VERIFIED, contrast/px RE-COMPUTED ≥ threshold)

I independently re-computed the contrast/px of the three just-landed design fixes against the on-disk tokens at HEAD — not trusting the commit messages.

### AGG-R8c3-04 / DES-1 — `text-destructive` dark-mode contrast → **VERIFIED CLEAN** (commit `77013cd0`)
A dedicated `--destructive-text` foreground token was added (`globals.css:43,69,97` HSL + `:130,139,147` oklch) and wired as Tailwind `text-destructive-text` (`tailwind.config.ts:57`). Recomputed:

| Mode | Token (HSL) | Surface | Ratio | Verdict |
|---|---|---|---|---|
| Light | `0 73.7% 41.8%` (≈ red-700 #b91c1c) | white `--card` | **6.46:1** | PASS (≥4.5) |
| Dark | `0 90.6% 70.8%` (≈ red-400 #f87171) | dark `--card` `240 10% 3.9%` | **7.20:1** | PASS |
| OLED | same | oled `--card` `#0a0a0a` | **7.15:1** | PASS |
| Dark `/90` (alert *description*, `ui/alert.tsx`) | composited 90% over dark card | | **5.97:1** | PASS |
| Light `/90` | | white card | **5.58:1** | PASS |

**Adoption is comprehensive — ZERO bare `text-destructive` *text* sites remain.** `grep` for `text-destructive\b` minus `-foreground`/`-text` returns **0 hits**; **20** sites now use `text-destructive-text`, including the highest-traffic public/admin error paths the prior cycle flagged: `login-form.tsx:98` (`role="alert" aria-live="assertive"`), `bulk-edit-dialog.tsx:329`, `admin-user-manager.tsx:122,160`, `upload-dropzone.tsx:456,524`, `sales-client.tsx:90,191`, `tokens-client.tsx:136`, plus the shared `ui/alert.tsx` destructive variant. The `bg-destructive text-destructive-foreground` button sites (white-on-red, already ≥4.53:1) are correctly left unchanged. **The widest-impact a11y fix of the cycle lands clean in both light and dark.**

### AGG-R8c3-06 / DES-2 — 24px alias button + audit scale-token blind spot → **VERIFIED CLEAN** (commit `d70c1d98`)
- `categories/topic-manager.tsx:333` is now `min-h-11 min-w-11` = **44×44 px** (inner `X` stays `h-3 w-3`). Re-read at HEAD.
- The `touch-target-audit.test.ts` FORBIDDEN set gained scale-token patterns; the audit runs **12/12 green** live, and the prior cycle's verifier proved the new pattern trips 0→1 on a synthetic `min-h-6` button. The enforcement hole is closed.

### AGG-R8c3-07 / AGG-R8c3-08 / DES-3 / DES-4 — amber dark-mode contrast → **VERIFIED CLEAN** (commit `ecd093ab`)
| Site | Now | Light | Dark | Verdict |
|---|---|---|---|---|
| `histogram.tsx:608` (PUBLIC clip hint) | `text-amber-700 dark:text-amber-300` | 5.02:1 | **13.80:1** | PASS both |
| `settings-client.tsx:674` (admin warning) | `text-amber-700 dark:text-amber-400` | 5.02:1 | **11.92:1** | PASS both |

Both now match the established `text-amber-700 dark:text-amber-300/400` mirror convention.

---

## Findings

Severity legend: **HIGH** = WCAG A/AA failure on a public/shipped surface · **MED** = AA failure on admin surface, or audit/coverage gap · **LOW** = AAA / polish / consistency.

---

### DES-A1 — sales `StatusBadge` `pending` (amber-600 3.19:1) AND `downloaded` (green-600 3.30:1) fail WCAG 1.4.3 small-text in LIGHT mode — **MED** (confidence: High) — NEW, NOT covered by the AGG-R8c3-08 amber fix

**Where:** `app/[locale]/admin/(protected)/sales/sales-client.tsx:91,93`
```jsx
downloaded: { label: t.statusDownloaded, cls: 'text-green-600 dark:text-green-400', Icon: Check },   // :91
pending:    { label: t.statusPending,    cls: 'text-amber-600 dark:text-amber-400', Icon: Clock },   // :93
```
Rendered by `StatusBadge` (`:96-101`) as `<span className="inline-flex items-center gap-1 {cls}">…{label}</span>` — the colored text sits **directly on the table cell** (page `bg-background`, white in light mode), NOT on a colored pill. It is small inline text (`<table className="… text-sm">`, icon `h-3.5 w-3.5`).

**Computed (small-text needs 4.5:1):**
| Status | Token | Light on white | Dark on `--card` |
|---|---|---|---|
| `pending` | amber-600 #d97706 | **3.19:1 — FAIL** | amber-400 → 11.92:1 PASS |
| `downloaded` | green-600 #16a34a | **3.30:1 — FAIL** | green-400 → 11.42:1 PASS |

So **both** statuses are light-mode failures (3.19 / 3.30 < 4.5) on a shipped admin surface. They clear the 3:1 large-text bar, but this is small text.

**Why this is genuinely open (not a re-report):** the AGG-R8c3-08 fix (`ecd093ab`) corrected the *other two* amber sites (settings + histogram) but the plan/aggregate explicitly cited `sales-client.tsx:93` as the *correct reference* ("uses the correct `text-amber-600 dark:text-amber-400`"). That judgement was wrong about the **light** value: `amber-600` on white is the same 3.19:1 the fix elsewhere corrected to `amber-700`. The sibling `green-600` has the identical defect and was never examined. The `StatusBadge` is excellently triple-encoded (text + color + icon, WCAG 1.4.1 for color-blind users) — but 1.4.1 and 1.4.3 are independent criteria, and the text-contrast still fails.

**Impact:** an operator reading the sales table in light mode (the default) sees "Pending" and "Downloaded" status text at ~3.2:1 — legible-ish for a sighted user but below AA, and the worst case for low-vision operators auditing payment state. Two of the four statuses are affected.

**Fix:** mirror the cycle's own amber convention — `text-amber-700 dark:text-amber-400` for `pending` (amber-700 on white = 5.02:1) and `text-green-700 dark:text-green-400` for `downloaded` (green-700 #15803d on white = **4.54:1**, just clears AA). One-line change per status; dark values already pass so keep them. (`refunded` uses `text-destructive-text` = 6.46:1 ✓, `expired` uses `text-muted-foreground` = 6.04:1 ✓ — only the two above need the bump.)

---

### DES-5 — Nav theme/locale/expand buttons + title/topic Links have no `focus-visible` ring — **LOW** (confidence: High) — RE-CONFIRMED OPEN (plan-336 Deferred-6)

**Where:** `components/nav-client.tsx:85` (title `<Link>`), `:93` (mobile-expand toggle), `:122` (topic `<Link>`s), `:155` (theme), `:166` (locale).

**Evidence (re-read at HEAD):** all five carry only `hover:bg-accent` / `hover:text-foreground hover:bg-muted/50` and **no** `focus-visible:ring-*`. There is no global `:focus-visible` base rule in `globals.css` and no custom ring in `tailwind.config.ts`. By contrast the app uses `focus-visible:ring` at **29** sites and the shadcn `<Button>` base ships `focus-visible:ring-[3px]` — these nav controls are the outliers. They do **not** set `outline-none`, so the UA-default outline still applies (so this is *not* a hard 2.4.7 failure), but it is visually inconsistent and the thin default outline is easy to miss against the translucent `bg-background/20` nav, which is top-of-page chrome on every route.

**Status:** explicitly RECORDED as deferred in `plan-336` Deferred-6 (no WCAG fail; polish pass). Re-confirmed present; **not** re-escalated. Fix when the UI-polish pass runs: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the three `<button>`s (and the two `<Link>`s) to match the rest of the app.

---

### DES-6 — Color-pip `text-white/50` gamut suffix (thinnest margin) + histogram dotted-underline affordance is faint — **LOW** (confidence: Medium) — RE-CONFIRMED OPEN (plan-336 Deferred-6)

**Where:**
- `components/lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` inside a `bg-white/10` chip on the `bg-black/80` panel. Computed: white@50% over (white@10% over near-black) = **5.15:1** — *passes* 4.5:1 but is the thinnest color-UI margin, and the text is `text-[10px]`.
- `components/histogram.tsx:691` — the key-type tooltip trigger is `<span … className="… cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">`. The `/40` decoration is ~2:1 — the "this is interactive / has a tooltip" cue is barely visible (the span *text* itself, `text-muted-foreground`, is fine at 6.04/7.76:1).

**Status:** RECORDED deferred (plan-336 Deferred-6); both pass text contrast, the weaker is the affordance cue. Re-confirmed present. Optional polish: suffix → `text-white/70` (~9:1), underline → `decoration-muted-foreground/70`.

---

### DES-7 — Info-sidebar topic `<Badge>` renders the raw slug, not the humanized label — content consistency — **LOW** (confidence: High) — RE-CONFIRMED OPEN (plan-336 Deferred-6)

**Where:** `components/photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` prints the **raw slug** (e.g. `music-festival`). In the SAME info card: the Back button at `:603` uses `image.topic_label || image.topic` (humanized), and the adjacent tag chips at `:836` run through `humanizeTagLabel(tag.name)` (→ `#Music Festival`). So a viewer sees a hyphenated lowercase topic slug sitting between a humanized Back-button label and humanized tag chips.

**Status:** RECORDED deferred (plan-336 Deferred-6; cosmetic, not an a11y blocker). Re-confirmed present. Fix: render `image.topic_label || image.topic` in the Badge (the value the Back button already uses).

---

## Sub-threshold observations (no finding — recorded for coverage)

- **`focus:ring` vs `focus-visible:ring` (5 sites):** `tag-input.tsx:183`, `upload-dropzone.tsx:373`, `topic-manager.tsx:333` (the just-fixed alias button), plus shadcn's own `ui/dialog.tsx`/`ui/sheet.tsx` close buttons use the older `focus:ring` form. Effect: the ring also shows on **mouse-click**, slightly noisier than the app's dominant `focus-visible:` pattern (29 sites). Not a WCAG failure (focus IS indicated). Cheap consistency nit; the alias button at `:333` could become `focus-visible:` to match its neighbours.
- **Upload remove-X icon over photo thumbnail (`upload-dropzone.tsx:475`, WCAG 1.4.11):** default-state `<X>` inherits `text-foreground` over `bg-background/50` (a 50% scrim) over an arbitrary photo. The scrim mitigates but does not *guarantee* 3:1 for the graphical icon against a mid-tone photo. Solid `hover:bg-destructive` rescues hover/focus. Admin-only, small icon, reasonable mitigation in place — recorded, not raised. If touched, add a fuller scrim (`bg-background/70`) or a subtle ring.
- **Histogram clip labels `text-red-500` (`histogram.tsx:671,674`):** #ef4444 = **3.76:1 on white** (below 4.5 small-text) but **5.29:1 on the dark `--card`** where the histogram lives (lightbox/sidebar are dark-surface-heavy; panel `bg-black/20`). Short bold numeric percentages, borderline. The prior cycle noted this sub-threshold; unchanged. If a future pass touches it, add a light-mode `text-red-600` (4.55:1).

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD)

Spot-re-checked beyond the prior cycle's list; correct at `ce0029aa`:

- **`--destructive-text` blast radius:** all destructive *text* (alerts, validation, ghost-delete labels, status) migrated to the new token; all destructive *button backgrounds* unchanged & still white-on-red ≥4.53:1; the two destructive **hover** flips (`tag-input.tsx:183` → `text-destructive-foreground`, `upload-dropzone.tsx:475` → `text-white`) keep the icon readable on the destructive bg. No site hovers into an unreadable state.
- **Dialogs/modals:** every dialog (`image-manager`, `bulk-edit-dialog`, `admin-user-manager`, `db/page`, `topic-manager`, `tag-manager`, `tokens-client`, `sales-client`) uses Radix `ui/dialog`/`ui/alert-dialog` → built-in focus trap + `aria-modal` + Escape + focus restoration. The 3 custom overlays (lightbox `:450`, search `:315`, info-bottom-sheet `:201`) all carry manual `FocusTrap` + `role="dialog" aria-modal`.
- **`tokens-client.tsx` (not in prior compliant list):** all interactive controls `h-11 w-11` / `min-h-[44px]`; correct `text-destructive-text` (`:136`); `aria-label`s on icon buttons; IME composition-commit guard on Enter (`:165`); copy/revoke flows in proper Radix dialogs. Clean.
- **`tag-input.tsx` combobox:** the inner `<input>` `outline-none` (`:199`) is intentional — the focus ring is hoisted to the wrapper `<div>` `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2` (`:176`). Option rows `min-h-11`, `role="option"`, `aria-activedescendant`, remove buttons `min-h-11 min-w-11`. Standard accessible pattern.
- **`outline-none` audit:** every `outline-none` either pairs with `focus:ring`/`focus-within:ring` (inputs, tag-input wrapper) or is a programmatic skip-target (`main#main-content tabIndex={-1} focus:outline-none`, `not-found.tsx:28`) where suppressing the ring on script-focus is correct. No interactive element strips its outline without a replacement.
- **RTL/i18n:** `layout.tsx:99` sets `dir="ltr"` explicitly; en/ko are both LTR, no RTL target — correct.
- **Touch-target gate:** `vitest run touch-target-audit` → **12/12 pass** (live), including the new scale-token patterns. image-manager checkbox label wrappers still `min-h-11 min-w-11` (AGG-R8-03 intact).
- **State coverage:** `admin/(protected)/error.tsx` + `loading.tsx`, `[locale]/error.tsx`, `not-found.tsx` all present.
- **(Carried-forward from prior cycle, spot-checked, unchanged):** lightbox/search/bottom-sheet focus traps + restoration; all lightbox controls `h-11 w-11`; `aria-live` regions for slideshow/position/load-more; reduced-motion blanket override (`globals.css:291`); `forced-colors` handling for hdr/gamut/pip badges + masonry overlay; `muted-foreground` 40% L → 6.04/7.76/7.72:1; masonry CLS reservation via `aspectRatio` + `containIntrinsicSize`; back-to-top co-toggles `aria-hidden`+`tabIndex`+`pointer-events`; settings form 16 `aria-describedby` all resolve.

---

## Summary / priority for the plan

1. **DES-A1 (MED, NEW):** sales `StatusBadge` `pending` (amber-600 = 3.19:1) and `downloaded` (green-600 = 3.30:1) fail WCAG 1.4.3 small-text in **light** mode on the white sales table. The AGG-R8c3-08 amber fix corrected settings + histogram but mis-cited this file as the reference and missed both its light-mode failures (the green sibling was never examined). One-line-per-status swap: `text-amber-700`/`text-green-700` for the light value, keeping the passing `dark:` values. **This is the one substantive, currently-open a11y finding this pass.**
2. **DES-5/6/7 (LOW, all RE-CONFIRMED OPEN = plan-336 Deferred-6 / AGG-R8c3-17):** nav focus-visible ring; color-pip `text-white/50` thin margin + faint histogram underline; info-sidebar topic Badge raw slug. All present at HEAD, all already recorded as deferred polish — listed here only to confirm they have not regressed or been silently dropped. No re-escalation.

**Net:** the three run-8-c3 design fixes (`text-destructive`, 24px alias button, amber dark-mode) are **VERIFIED CLEAN with re-computed ratios ≥ threshold in every mode**. The only newly-actionable item is DES-A1 — the sales status badge's two light-mode contrast failures that the amber fix's scope missed. Everything else is the previously-deferred LOW polish trio, confirmed unchanged.
