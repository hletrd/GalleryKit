# Code reviewer — cycle 3 provenance

Review target: `afa11cf4` (`master`), 2026-07-18 KST. Review only; no source, plan, aggregate, or git state was changed.

## Relevant-file inventory and method

I enumerated all 939 repository files before reviewing: 81 App Router files, 115 library files, 61 components, 3 DB files, 368 unit-test files, 12 Playwright files, 29 scripts, all 31 migration SQL files plus journal/reconcile, public/PWA assets, package/build/lint/type configs, Docker/Compose/nginx/deploy surfaces, and `AGENTS.md`, `CLAUDE.md`, both READMEs, current review history, and the authoritative deferred register. I traced every change since the cycle-2 start (`ba4bc60a`) through its consumers and tests, then swept actions/routes, DB and filesystem lifecycles, queues/locks, image scheduling, error paths, suppressions, and source-contract tests. ESLint, all three custom architectural linters, typecheck, and `git diff --check` passed.

## Genuinely new cycle-3 findings

### CR-C3-01 — “First row” scheduling selects the wrong photos in CSS multi-column layout

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**, newly discovered in cycle 3; the newest home preload path was introduced by `2875b816`, while the same latent assumption exists on adjacent archive/share surfaces
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`; `apps/web/src/components/masonry-card.tsx:21-33,121-145`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187-196,220-245`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:138,227-282`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:131,189-241`

The code equates DOM indices `0..columnCount-1` with the visual first row and now preloads indices 1-4 at desktop breakpoints. CSS multi-column layout flows top-to-bottom and balances chunks across columns; it is not row-major. A headless Chromium geometry check at four columns with 20 equal cards placed indices `0,5,10,15` at `y=0`, while indices `1..4` stayed down the first column (`y=196..784`). Real variable aspect ratios make the boundary data-dependent rather than restoring the assumption.

Concrete failure: desktop downloads cards 2-5 early even when some are below the fold, while the top card in columns 2-5 remains lazy/normal priority. If one of those omitted top cards becomes LCP, the attempted LCP fix delays it and spends bandwidth on the wrong images. Shared-group and archive pages repeat the same first-N heuristic.

Suggested fix: do not claim row membership from DOM index under CSS columns. The contained safe fix is to prioritize only the universally top-left first item and let viewport discovery schedule the rest. If deterministic first-row priority is required, adopt a layout with known row membership (or explicit server/client column assignment based on the known dimensions) and preserve reading order. Add browser geometry plus request-timeline assertions at each column breakpoint.

### CR-C3-02 — The completed plan claims browser request coverage that does not exist

- Severity: **Low-Medium**
- Confidence: **High**
- Status: **Confirmed** evidence/maintainability gap; it directly allowed CR-C3-01 to pass
- Regions: `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`; `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123`; `apps/web/e2e/public.spec.ts:4-19`

The plan marks “browser request-timeline coverage at 320 px and desktop width” complete, but the only new masonry test reads source text and asserts that preload-related strings are present. The Playwright change covers search ARIA state; no E2E spec observes preload requests or card geometry. Thus all gates pass while the actual hints target the wrong elements.

Concrete failure: future breakpoint/media/srcset changes—and the current multicolumn ordering defect—remain green as long as the expected strings remain in the file.

Suggested fix: correct the completion record and add a cold-context Playwright test that records derivative requests before hydration at mobile/desktop widths, correlates requested image ids with `getBoundingClientRect().top`, and proves no below-fold card is explicitly preloaded ahead of visible column leaders.

## Revalidated carry-forward (not new)

### CR-C3-R1 — Failed deploy health leaves the failed release active

- Severity/Confidence: **Medium / High**
- Region: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:3-17`
- Status: unchanged carry-forward

`docker compose up -d --build` replaces the fixed-name container before the health loop. On failure the script logs and exits without restoring the prior image/container, so the unhealthy release remains live/restarting. Capture and restore the prior release or use candidate promotion after health.

## Final missed-issue/file-coverage sweep

The closing sweep rechecked recent sitemap caching, search state races, React resource-hint output, action/auth/rate-limit scanners, migration journal/reconcile parity, privacy projection guards, advisory-lock release helpers, restore/file cleanup paths, queue reset state, service-worker generated/template parity, raw SQL, path construction, timers/listeners, swallowed errors, and all suppressions. The sitemap and combobox fixes match their stated runtime ownership; no additional new critical/high correctness defect survived validation. Existing scale, deploy, restore-generation, and single-writer risks remain in the carry-forward register rather than being relabeled as cycle-3 discoveries.
