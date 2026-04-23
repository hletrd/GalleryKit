# Cycle 3 (RPL loop) — Implementation plan

**Date:** 2026-04-23
**Source:** `.context/reviews/_aggregate-cycle3-rpl.md` (16 specialist reviews aggregated)
**Mandatory input:** `plan/user-injected/pending-next-cycle.md` (HIGH priority comprehensive UI/UX audit) — fully ingested into the designer-* per-specialist artifacts under `.context/reviews/` and into AGG3R-01..12 below.

## Plan items

| ID | Source | Severity | Plan | Owner | Status |
|---|---|---|---|---|---|
| C3R-RPL-01 | AGG3R-01 | MEDIUM | Add `<h1 class="sr-only">` to photo viewer; promote `CardTitle` (sidebar info) to `<h2>` so heading hierarchy is intact | (this cycle) | scheduled |
| C3R-RPL-02 | AGG3R-02 | MEDIUM | Add `aria-label` to locale-switch button in `nav-client.tsx`; add `aria.switchLocale` translation in `en.json` and `ko.json` | (this cycle) | scheduled |
| C3R-RPL-03 | AGG3R-03 | LOW | Bump tag-filter pill height to ≥24px (change `py-0.5` → `py-1` in `tag-filter.tsx`) | (this cycle) | scheduled |
| C3R-RPL-04 | AGG3R-04 | LOW | Add visually-hidden `<h2>` between H1 and photo-card H3s on home gallery (`home-client.tsx`) | (this cycle) | scheduled |
| C3R-RPL-05 | AGG3R-05 | LOW | Add `dir="ltr"` to `<html>` in `[locale]/layout.tsx` | (this cycle) | scheduled |
| C3R-RPL-06 | AGG3R-07 | LOW | Convert DB-restore `window.confirm()` to styled `AlertDialog` matching other destructive flows | (this cycle) | scheduled |
| C3R-RPL-07 | TE3-01 | LOW | Add Vitest/Playwright assertion that `/p/[id]` renders exactly one `<h1>` so AGG3R-01 doesn't regress | (this cycle) | scheduled |

## Out-of-scope this cycle (deferred — see `cycle3-rpl-deferred.md`)

- AGG3R-06 (footer admin contrast — intentional design choice, AA-compliant)
- AGG3R-08 (password min-length hint — polish)
- AGG3R-09 (delete-topic clarification text — polish)
- AGG3R-10 (search ARIA-live — polish)
- AGG3R-11 (collapsed nav focus-ring clip — needs verification)
- AGG3R-12 (CLAUDE.md heading policy — doc-only, low confidence)
- All carry-forwards from prior cycles remain status-quo.

## Acceptance gates (must pass before deploy)

- `npm run lint --workspace=apps/web` clean
- `npm run lint:api-auth --workspace=apps/web` clean
- `npm run lint:action-origin --workspace=apps/web` clean
- `npm test --workspace=apps/web` all 221+ tests pass + new test for C3R-RPL-07
- `npm run build --workspace=apps/web` succeeds (tsc + Next bundle)
- Playwright e2e (`npm run test:e2e --workspace=apps/web`) — best-effort if local DB available; otherwise skipped per existing pattern.

## Rollout

- Per-cycle deploy (`npm run deploy`) after all gates green and all commits pushed.

## Commit cadence

- One semantic, gitmoji-prefixed, GPG-signed, conventional-commit per item.
- After every commit: run gitminer (`~/flash-shared/gitminer-cuda/mine_commit.sh 7`) per CLAUDE.md mandate.
