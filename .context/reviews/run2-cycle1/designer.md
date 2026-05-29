# Designer (UI/UX) Review — Run-2 Cycle 1 (HEAD eaee58dc)

Static UI/UX + a11y review (no dev server / DB in sandbox; findings are text-evidence-backed). Faithful-delivery surface — no editing/rating UI.

## UX-01 — In-app backfill gives no completion/error feedback after "queued" (LOW, Medium confidence)

**File:** `settings-client.tsx:92-115` (`handleBackfill`) + `admin-backfill.ts:65-83` (`getBackfillStatus`).
The button toasts "queued (N photos)" then the `isBackfilling` transition ends — but the actual background encode runs for minutes/hours with NO further UI signal. `readAdminBackfillState()` tracks `running`, `completedRuns`, `lastError`, and `getBackfillStatus` exposes `running` + `candidateCount`, yet `settings-client.tsx` never polls them. A photographer who triggers a backfill, sees "queued", then refreshes the page has no way to know whether it's still running, finished, or errored. **Impact:** uncertainty after a long-running op; possible duplicate clicks across page loads (the advisory lock + `already_running` toast does protect correctness — a second click while running correctly toasts "already running"). **Fix (optional, scope-appropriate to defer):** poll `getBackfillStatus` while a backfill is known-running and show "Re-encoding… (N remaining)" / "Done". The plumbing already exists. LOW.

## UX-02 — Backfill button disabled state only covers the request transition, not the background run (LOW, Medium confidence)

**File:** `settings-client.tsx:213` `disabled={isBackfilling}`. `isBackfilling` is the `useTransition` pending flag for the SERVER ACTION call only (returns in ms with `queued`). Once the action returns, the button re-enables even though the background encode is still running. A second click correctly hits the `already_running` guard (server-side) and toasts — so no double-execution — but the button visually invites a click that will "fail". **Fix:** combine with UX-01 polling so the button stays disabled (with a "Re-encoding…" label) for the duration of the actual run. LOW; current behavior is safe, just slightly confusing.

## UX-03 — Touch targets / a11y on new UI — VERIFIED COMPLIANT

- Backfill button: `h-11` (settings-client.tsx:214) → 44px. ✓
- Analytics window buttons: `min-h-11 min-w-11` (analytics-client.tsx:68). ✓ `aria-pressed` + `role="group"` + `aria-label`. ✓
- Histogram collapse + cycle buttons: `min-h-11 min-w-11` (histogram.tsx:636, 723), `aria-label` present, `focus-visible:ring`. ✓ Canvas has `role="img"` + localized `aria-label`. ✓
- WideGamutHint dismiss: `min-h-11 min-w-11`, `aria-label`, `role="status"` + explicit `aria-live="polite"`/`aria-atomic` (wide-gamut-hint.tsx:188-189, 204). ✓ Dark-mode contrast lifted to ≈4.6:1 (documented). ✓
- Lightbox: `aria-keyshortcuts="Escape"`, Escape closes color pip before lightbox (R28-UX-HIGH-1). ✓

## UX-04 — i18n completeness — VERIFIED BALANCED

All new keys present in BOTH en.json and ko.json:
- `settings.backfillTriggerTitle/Hint/Cta`, `backfillQueued/NothingToDo/AlreadyRunning/Unavailable/Failed/Running` → en=1 ko=1 each.
- `analytics` block: identical key set in en + ko (19 keys, including `topSharedAlbumsTitle`, `colSharedAlbum`). The page resolves them server-side and passes as props; any missing key would throw at render — none missing.

## UX-05 — Analytics shared-album empty state (INFO)

`analytics-client.tsx` shared-album section uses the shared `t.noData` empty-state row (consistent with the other four tables). The deep-link uses `target="_blank" rel="noopener noreferrer"` (line 223-224). Consistent and correct. No finding.

## Clean
No WCAG 2.2 / keyboard / focus / contrast regressions found in the new UI. Reduced-motion: spinners use `animate-spin` (acceptable; no large parallax). Dark/light handled via Tailwind dark: variants throughout.
