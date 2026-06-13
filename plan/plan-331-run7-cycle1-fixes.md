# Plan 331 — Run-7 Cycle 1 fixes (MED a11y/maintainability/test + LOW correctness)

**Source:** `.context/reviews/_aggregate.md` (run-7 cycle-1 fan-out, 10 agents, 0 failures).
**Gate baseline (live-verified before planning):** lint exit 0 · typecheck exit 0 · 3 security lint gates exit 0 · vitest 2025 pass / 1 timeout-flake. All 19 gates green at HEAD.
**Commit discipline (CLAUDE.md + global):** GPG-sign every commit (`git commit -S`), Conventional Commits + gitmoji, ONE commit per item, `git pull --rebase` then push after each, NO `Co-Authored-By`, NO `--no-verify`, NO force-push. Full gate run before cycle close; per-cycle deploy via `npm run deploy` after gates green.

**Scope note:** the prior run's plans 328 (all DONE) / 329 / 330 left their PROGRESS tables badly stale — many items they mark TODO/deferred are ALREADY implemented and test-backed at HEAD (AGG-8, AGG-10, AGG-13, AGG-16, AGG-18). Plan-332 Unit C corrects those tables. This plan schedules ONLY genuinely-open findings.

---

## Item 1 — AGG-R7-01: remove the 3 stale pool-budget formula comments (MED · 6 agents · half-applied fix)

- **Sources:** CRT-3, CRT-4 (critic), ARCH-R6C1-01 (architect), TRC-5 (tracer), DOC-05 (document-specialist), perf-reviewer. Strongest cross-agent agreement this cycle.
- **Problem:** the working-tree AGG-5 change updated `resolveBackfillConcurrency`'s CODE + its function-body docblock to the reserved-headroom formula (cap=2 at pool 10), but left THREE stale sites still asserting the removed `floor((LIMIT-2)/2)=4` arithmetic — a file that contradicts itself and misleads operators about the very invariant the change fixed.
- **Where:**
  1. `apps/web/src/lib/admin-backfill-runner.ts` — the FILE-HEADER docblock (~lines 28-35, the `AGG-R5C3-05` block ABOVE `BACKFILL_RESERVED_LIVE_CONNECTIONS`) still states cap `= floor((LIMIT-2)/2)` / `= 4`. NOTE: the *function-body* docblock just above `resolveBackfillConcurrency` (~103-122) is ALREADY correct (cap=2, RESERVED). Fix only the stale header block.
  2. `apps/web/src/db/index.ts:~13-19` — the `POOL_CONNECTION_LIMIT` comment references the old `(LIMIT-2)/2` backfill arithmetic.
- **Change:** rewrite both stale comments to match the shipped formula: `cap = max(1, floor((LIMIT − RESERVED − 1) / 2))`, `RESERVED = max(3, ceil(LIMIT/2))`, → cap=2 at LIMIT=10 (reserves ≥5 for live traffic). **Per CRT-2 / data.ts:100 nuance:** do NOT assert "a single getImage needs 3 SIMULTANEOUS connections" — the pool may serialize the `Promise.all` across fewer physical connections under contention. State the rationale as "reserve headroom so live photo/gallery renders don't queue behind encode-duration connection holds." Single source of truth: point both comments at `resolveBackfillConcurrency`'s function docblock rather than re-deriving.
- **NO code change** (the code is verified-correct). Comment-only.
- **Acceptance:** `grep -rn "LIMIT-2\|LIMIT - 2\|(limit - 2)\|= 4\b" apps/web/src/lib/admin-backfill-runner.ts apps/web/src/db/index.ts` returns no stale-formula hit; all 19 gates stay green; the file no longer self-contradicts.

## Item 2 — AGG-R7-02: clear the backfill poll `setTimeout`s on unmount (MED · debugger · regression-survivor)

- **Source:** BUG-1 (debugger). AGG-15's mount-effect half landed but the timer-cleanup half (prescribed in the prior aggregate) was never implemented.
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — `handleBackfill` (~lines 130-150) schedules two post-trigger refreshes via `setTimeout(refreshBackfillStatus, 3000)` and `setTimeout(refreshBackfillStatus, 10000)` with NO `clearTimeout` in any cleanup. Leaving Settings within 10s of a trigger fires `setBackfillStatus` on an unmounted tree (React dev warning + a wasted state write).
- **Change:** hold the scheduled timeout ids in a `useRef<ReturnType<typeof setTimeout>[]>([])` (or a single ref array), push each timer id when scheduled, and clear them all in a component-level `useEffect(() => () => { timers.current.forEach(clearTimeout); }, [])` cleanup. Keep `refreshBackfillStatus` as-is (it already no-ops when `!hasExistingImages`); the goal is purely to prevent the dead-tree setState. (Optional belt-and-braces: a module-level `mountedRef` gate inside `refreshBackfillStatus`, but the clearTimeout approach is sufficient and matches the mount-effect's `cancelled` pattern.)
- **Acceptance:** navigating away within 10s no longer leaves live timers (verified by reasoning + a render/unmount test if cheap); no React "setState on unmounted component" path remains; lint (`react-hooks/*`) stays exit 0; gates green.

## Item 3 — AGG-R7-03: restore a visible heading to both error shells (MED a11y/UX · WCAG 1.4.3 sighted · designer + critic)

- **Source:** DES-02 (designer). Introduced by the AGG-9 working-tree fix.
- **Problem:** the AGG-9 fix correctly moved the accessible name to an `sr-only <h1>` and left the big title as a faint `text-muted-foreground/30` (~1.5:1) `aria-hidden` glyph. But a SIGHTED user now sees only the faint title and NO readable heading — inconsistent with the repo's own `not-found.tsx`, which shows a visible readable `<h1>` (`text-2xl font-semibold`) plus a `/60`-opacity decorative numeral.
- **Where:**
  - `apps/web/src/app/[locale]/error.tsx:18-19` (public twin)
  - `apps/web/src/app/[locale]/admin/(protected)/error.tsx:29-30` (admin twin, working tree)
  - Reference pattern: `apps/web/src/app/[locale]/not-found.tsx:36-44` (decorative `/60` numeral + visible `text-2xl` h1).
- **Change (mirror the 404 pattern):** keep the big glyph decorative + `aria-hidden`, but (a) bump its opacity from `/30` to `/60` so it clears WCAG 1.4.3 in both themes (matching not-found's `/60` rationale, comment F-14), AND (b) promote a VISIBLE readable heading. Cleanest: make the existing `<h1>` visible (drop `sr-only`, give it `text-2xl font-semibold tracking-tight` like not-found) and demote the big glyph to a decorative `aria-hidden` span ABOVE it. The error `<p>` description stays as the supporting copy. Result matches not-found exactly: decorative big glyph (`/60`, aria-hidden) → visible readable h1 → description → actions. Apply to BOTH shells for consistency. Update the AGG-9 comment to reflect the final shape (visible h1 + decorative-/60 glyph) and remove any wording that says the title is sr-only-only.
- **Acceptance:** both error shells render a VISIBLE heading at WCAG-passing contrast AND an accessible-tree h1 (now one and the same); the decorative glyph is `aria-hidden` at `/60`; `aria-labelledby` still resolves to the (now visible) h1 id; matches not-found's heading treatment; touch-target + a11y tests green; covered by Item 5's new test.

## Item 4 — AGG-R7-04: wire `aria-describedby` on the remaining ~10 settings hints (MED a11y · WCAG 1.3.1/3.3.2 · designer)

- **Source:** DES-01 (designer); completes the AGG-11 partial (8 already wired).
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — controls whose adjacent hint `<p className="text-xs text-muted-foreground">` has no `id` and whose input/select lacks `aria-describedby`:
  - 3 quality inputs: `image-quality-webp` (~320), `image-quality-avif` (~333), `image-quality-jpeg` (~346) — hints `qualityHintWebp/Avif/Jpeg`.
  - 3 chroma/effort selects: wide-gamut JPEG chroma (~437), SDR JPEG chroma (~454), AVIF effort (~480).
  - wide-gamut-max-source-pixels input (~494).
  - 3 license inputs (~662, ~674, ~686).
  (Confirm the exact set by reading each; the count is ~10. Verify by `grep -c 'text-xs text-muted-foreground'` vs the 8 wired ids.)
- **Change:** give each hint `<p>` a stable, unique `id` (kebab-case matching the control, e.g. `image-quality-webp-help`) and add `aria-describedby={thatId}` to the corresponding `<Input>` / `<SelectTrigger>`. Match the existing wired pattern (e.g. `image-sizes-help`). No duplicate ids.
- **Acceptance:** every settings control with a visible hint has `aria-describedby` resolving to exactly one hint element; `grep -c aria-describedby` rises from 8 to ~18 and equals the hint-`<p>` count; no duplicate ids (a quick uniqueness grep); gates green.

## Item 5 — AGG-R7-05: regression tests for the AGG-9 error-shell heading + AGG-10 home-title (MED test · 3 agents)

- **Sources:** TEST-1, TEST-2 (test-engineer), CRT-8 (critic). The AGG-9 and AGG-10 fixes shipped/ship with no test; a silent revert regresses them.
- **Where:** add to `apps/web/src/__tests__/` (extend `error-shell.test.ts` if it fits, else a new file e.g. `error-shell-heading.test.ts` + `home-metadata-title.test.ts`).
- **Change:**
  1. **Error-shell heading test:** assert (static-source or render) that BOTH `app/[locale]/error.tsx` and `app/[locale]/admin/(protected)/error.tsx` contain a VISIBLE `<h1>` (not `sr-only`) carrying `t('error.title')`/the accessible name AND that the decorative big glyph is `aria-hidden` at a contrast-passing opacity (`/60`, not `/30`). Pin against a revert to `/30` faint-only-with-sr-only-h1. (A source-regex fixture in the style of the touch-target audit is acceptable and avoids a full RTL render of a `'use client'` error boundary.)
  2. **Home-title test:** assert the home `generateMetadata` in `app/[locale]/(public)/page.tsx` returns `title: { absolute: ... }` in BOTH branches (og-image and latest-photo) so the layout template (`%s | {seo.title}`) is NOT re-applied → no `GalleryKit | GalleryKit` doubling. (Import the metadata fn with mocked deps, or a source-regex fixture pinning `{ absolute:` on the title field in both return shapes.)
- **Acceptance:** both tests FAIL against a synthetic reverted source (sr-only-only h1 / dropped `absolute`) and PASS at HEAD-after-Item-3; full suite green via `npx vitest run`. Run `npm run typecheck` before commit (test-file type errors only surface there).

## Item 6 — AGG-R7-07: enforce the dropzone disabled affordance (MED a11y · WCAG 4.1.2 · designer)

- **Source:** DES-03 (designer).
- **Where:** `apps/web/src/components/upload-dropzone.tsx:399-407` — the dropzone root has `role="button"` + `aria-disabled={uploading || !hasTopics}`, but `getRootProps()` keeps it focusable and click/keyboard-activatable; only the hidden `<input>` (line 407) is truly `disabled`. So an AT/keyboard user is TOLD it's disabled but can still trigger the file dialog.
- **Change:** when `uploading || !hasTopics`, make the disabled state real on the root: set `tabIndex={-1}` (remove from tab order) and gate the activation handlers — react-dropzone exposes `getRootProps()`; pass an `onClick`/`onKeyDown` that early-returns when disabled, OR (cleaner) conditionally omit the dropzone-open handlers / call `open` only when enabled. Keep `aria-disabled` for AT semantics. Do NOT regress the 44px target (the root is large). Confirm the visible `disabled:opacity-50` cue still applies.
- **Acceptance:** when disabled, the dropzone root is not in the tab order and clicking/Enter/Space does NOT open the file dialog; `aria-disabled` remains true; enabled behavior unchanged (drag + click both open). Verify by reading the handler wiring + a small interaction reasoning; touch-target/a11y tests green.

## Item 7 — AGG-R7-09: home-OG image on-disk fallback (LOW correctness · code-reviewer)

- **Source:** COR-3 (code-reviewer).
- **Where:** `apps/web/src/app/[locale]/(public)/page.tsx:~104` (the home `generateMetadata` og-image branch) builds a sized derivative URL for the social card with no existence check, unlike the per-photo OG route which uses a `pickFirstAvailablePhotoBuffer`-style first-available probe.
- **Problem:** a backfilling or legacy `latestImage` whose sized derivative isn't on disk yet yields a 404 social-card image until backfill catches up — a broken OG preview on share.
- **Change:** mirror the per-photo OG route's first-available strategy for the home card: prefer the sized derivative but fall back to the base/known-existing filename (the encoder atomic-rename contract guarantees the base JPEG always exists). If a cheap existence check isn't available in this server-component metadata path, fall back to the base derivative filename unconditionally (still a valid card) rather than a size that may be missing. Keep it minimal and LOW-risk.
- **Acceptance:** the home OG image URL resolves to an on-disk file for a freshly-uploaded/legacy latest image; no behavior change for fully-backfilled images; gates green. (If the existence-probe is infeasible without a refactor, document the chosen base-filename fallback inline.)

---

## Out of scope for this plan (see plan-332)

- Doc-drift batch AGG-R7-08 (CLAUDE.md `COLOR_IMPACTING_KEYS` count, Sharp-instance wording, pipeline-version attribution, backfill env-var docs) → plan-332 Unit A.
- AGG-R7-06 (401/403 deferral-note correction) → plan-332 Unit A (it's a plan/doc correction, not code).
- Plan-329/330 stale-table corrections → plan-332 Unit C.
- Deferred: AGG-R7-A2 (decode-once perf), AGG-R7-10 (load-more unmount), AGG-R7-11 (test depth), AGG-R7-12 (containIntrinsicSize), AGG-R7-13 (Stripe ACH — plan-316), arch observations → plan-332 deferred section.

---

## Progress

| # | Finding | Severity | Commit | Status |
|---|---|---|---|---|
| 1 | AGG-R7-01 (stale pool formula ×2 files) | MED | 0d17a362 | DONE |
| 2 | AGG-R7-02 (setTimeout unmount leak) | MED | f11746cd | DONE |
| 3 | AGG-R7-03 (error-shell visible heading) | MED | 0d2312cd | DONE |
| 4 | AGG-R7-04 (remaining aria-describedby) | MED | 61cfd235 | DONE |
| 5 | AGG-R7-05 (AGG-9/AGG-10 regression tests) | MED | d035de10 | DONE |
| 6 | AGG-R7-07 (dropzone disabled affordance) | MED | 35d07f0b | DONE |
| 7 | AGG-R7-09 (home-OG on-disk fallback) | LOW | 4852bcf5 | DONE |

**All 7 items DONE.** Note: item 1's commit (0d17a362) also folded in the AGG-5
formula CODE + its updated test (the prior run's uncommitted working-tree work),
since the stale-comment fix completes that half-applied change as one coherent
commit. Items 3 & 5 are paired (error-shell heading source fix + its regression
test). The AGG-9 (error H1) + AGG-5 (pool cap) working-tree items that the prior
plan-329 owned are landed via this cycle's commits 0d2312cd / 0d17a362.
