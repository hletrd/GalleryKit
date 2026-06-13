# Plan 329 — MEDIUM a11y / correctness / perf-margin (Run-6 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (run-6 cycle-1 fan-out).
**Commit discipline:** identical to plan-328 (GPG-signed, gitmoji, per-item commits, `pull --rebase` then push each, full gate run before close).

---

## Item 1 — AGG-9: port the AA-contrast error-H1 pattern to the admin error shell (MED a11y · WCAG 1.4.3)

- **Source:** DES-01 (designer, static evidence; comment falsely claims parity).
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/error.tsx:21-22` uses `<h1 id="admin-route-error-title" className="text-7xl font-bold text-muted-foreground/30">{t('error.title')}</h1>` — the visible H1 text IS the faint `/30` decorative color (~1.5:1 contrast) AND the accessible name.
- **Reference (correct pattern):** `apps/web/src/app/[locale]/error.tsx:18-19` — decorative `<span aria-hidden="true" className="text-7xl font-bold text-muted-foreground/30 block">{t('error.title')}</span>` + `<h1 id="route-error-title" className="sr-only">{t('error.title')}</h1>`.
- **Change:** mirror the public pattern in the admin error shell: decorative span (`aria-hidden`, the big faint glyph) + `sr-only` H1 carrying the real accessible name. Keep `aria-labelledby` pointing at the H1 id. Remove/correct any comment that claims parity already exists.
- **Acceptance:** admin error shell has one `sr-only` H1 (AA-contrast in the accessibility tree, since sr-only text has no contrast requirement) and the visible faint glyph is `aria-hidden`; no other visible low-contrast text serves as the heading. Touch-target + a11y tests stay green.

## Item 2 — AGG-10: stop home `<title>` template doubling (MED SEO/UX · WCAG/SEO)

- **Source:** DES-02 (designer, runtime: `<title>GalleryKit | GalleryKit</title>`).
- **Where:** `apps/web/src/app/[locale]/layout.tsx:24-26` sets `title.template = '%s | ${seo.title}'`. `apps/web/src/app/[locale]/(public)/page.tsx:40-41` sets `title = '#tag | ${seo.title}'` (filtered) or `title = seo.title` (no-filter). Next applies the template suffix to BOTH branches → `GalleryKit | GalleryKit` (no-filter) and `#tag | GalleryKit | GalleryKit` (filtered).
- **Change:** on the home page, return `title: { absolute: <computed> }` for BOTH branches so the layout template suffix is not re-applied (the home page already encodes `| ${seo.title}` in the filtered branch and IS the site root in the no-filter branch). Apply `absolute` in all three return shapes (`og_image_url` early return + the main return) at the `metadata.title` field — the OpenGraph/Twitter `title` fields are NOT templated by Next, so leave those as the plain string.
- **Acceptance:** home `<title>` renders exactly `GalleryKit` (no-filter) and `#tag | GalleryKit` (filtered) — single suffix. Verify no other page that relies on the template regresses (only the home page changes). Existing metadata tests (if any) green.

## Item 3 — AGG-11: wire `aria-describedby` on the 8 unlinked settings input hints (MED a11y · WCAG 1.3.1/3.3.2)

- **Source:** DES-03 (designer, static; 8 inputs have visible hint text not programmatically associated; 8 siblings already are).
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — enumerate the inputs whose adjacent `<p>`/hint is not referenced by `aria-describedby`.
- **Change:** give each hint a stable `id` and add `aria-describedby={hintId}` to its input/select/textarea. Match the existing wired pattern for consistency.
- **Acceptance:** every settings field with a visible hint has `aria-describedby` resolving to the hint element id; no duplicate ids. (If a browser run is feasible, confirm via accessibility snapshot that `describedby` resolves; otherwise static grep that each hint id is referenced exactly once.)

## Item 4 — AGG-5: correct the backfill pool-budget margin so live traffic keeps headroom (MED perf · 2 agents)

- **Sources:** PERF-N1 (architect), VER-3 (verifier). The `resolveBackfillConcurrency` cap `floor((POOL_LIMIT−2)/2)` = 4 pins 9/10 connections; the runner-header "1 free is sufficient" claim is false because a single `getImage()` fires a multi-connection `Promise.all` (data.ts).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts` `resolveBackfillConcurrency` + its header comment; `apps/web/src/db/index.ts` `POOL_CONNECTION_LIMIT`; CLAUDE.md backfill section (the doc half is in plan-330).
- **Change:** reserve roughly half the pool for live traffic. Replace the cap with `cap = max(1, floor((poolLimit − RESERVED_FOR_LIVE) / 2))` where `RESERVED_FOR_LIVE = max(3, ceil(poolLimit / 2))` (3 = one full `getImage` fan-out; half-pool keeps burst headroom). At POOL_LIMIT=10 this yields `floor((10−5)/2)=2` (down from 4) — a background op then pins ≤5/10, leaving ≥5 for live traffic. Update the header arithmetic comment to state the real reasoning (a live photo page needs ~3 simultaneous connections). Keep the clamp-DOWN warning log.
- **Acceptance:** update `__tests__/admin-backfill-concurrency-cap.test.ts` to pin the NEW formula (cap=2 at limit 10; cap≥1 floor; clamps requested>cap down; never returns 0 or negative). All backfill tests green. The runner header no longer claims "1 free is sufficient".

## Item 5 — AGG-8: TriState shape guard in `bulkUpdateImages` (MED · 2 agents · = plan-315 #1 / plan-325 #16)

- **Sources:** COR-2 (code-reviewer), critic. Confirmed still unimplemented at HEAD.
- **Where:** `apps/web/src/app/actions/images.ts:877-937` — dereferences `topic.mode` / `titlePrefix.mode` / `description.mode` / `licenseTier.mode` without shape validation after the `ids` check; a malformed admin payload 500s.
- **Change:** add an `isTriState(v): v is {...}` helper validating each updatable field's shape (the `{ mode, value }` discriminated shape the action expects) right after the `ids` validation; on any malformed field return `{ error: t('invalidInput') }` instead of dereferencing.
- **Acceptance:** unit test feeding a malformed-TriState payload (e.g. `topic: { mode: 123 }` or a non-object) → returns `invalidInput`, no throw. Existing bulkUpdate tests green. Action-origin lint gate unaffected (still returns early on `requireSameOriginAdmin`).

## Item 6 — AGG-16: close the touch-target gate `<Link>`/`<a>` + root-file blind spot (MED a11y test-gate · still-open)

- **Source:** CRT-3 (critic). Same blind-spot class as the Badge (R4C15) and native-select (R4C16) incidents — the 3 cycle-2 anchor fixes (incl. `not-found.tsx:45`) can silently regress.
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts` — `SCAN_ROOTS` omits root-level `app/[locale]/*.tsx`; FORBIDDEN set has no `<Link>`/`<a>` element pattern.
- **Change:** (1) add the root `app/[locale]/` directory files (non-recursive top-level: `not-found.tsx`, `error.tsx`, `global-error.tsx`, `layout.tsx`) to the scan set OR widen the existing admin/components walk to include them; (2) extend the FORBIDDEN regex set + `normalizeMultilineButtonTags` coverage to `<Link>` and `<a>` interactive elements carrying sub-44 `h-8`/`h-9`/`min-h-[<44px]` literals or `cn()` composites, mirroring the Button/Badge/select rules. Add a `KNOWN_VIOLATIONS` entry only if a current legitimate exemption exists (with re-open criterion comment) — otherwise files default to 0.
- **Acceptance:** the audit now scans the root `app/[locale]` files and anchor/Link elements; a synthetic `<Link className="h-8">` in a scanned file fails the audit; the suite is green at HEAD (no current real violation, or each documented). Run `npm run typecheck` before commit.

---

## Progress

> **[CORRECTION run-7 — AGG-R7 plan hygiene]** Five review agents (code-reviewer, verifier, test-engineer, critic, tracer) independently confirmed at HEAD that this table was STALE: every item below is DONE or superseded, NOT TODO. Updated to reflect HEAD reality so no future cycle re-schedules closed work. Evidence cited per row.

| # | Finding | Commit | Status |
|---|---|---|---|
| 1 | AGG-9 (admin error H1 contrast) | (working tree) → 0d2312cd (run-7) | DONE — superseded by AGG-R7-03: the AGG-9 sr-only-h1 split landed, then run-7 plan-331 item 3 promoted it to a VISIBLE readable h1 (`error.tsx`/admin `error.tsx`) |
| 2 | AGG-10 (home title doubling) | 8fc403a2 | DONE — `(public)/page.tsx:50` `{ absolute: title }` in both branches; pinned by `home-metadata-title.test.ts` (run-7) |
| 3 | AGG-11 (settings aria-describedby) | (partial) → 61cfd235 (run-7) | DONE — 8 controls wired previously; run-7 plan-331 item 4 wired the remaining 10 (18 total `aria-describedby`) |
| 4 | AGG-5 (pool-budget margin) | (working tree) → 0d17a362 (run-7) | DONE — `resolveBackfillConcurrency` reserve formula (cap 2 @ pool 10); the 3 stale formula comments were fixed run-7 (AGG-R7-01) |
| 5 | AGG-8 (bulkUpdate TriState guard) | 652add51 | DONE — `isTriState` early `invalidInput`, `images.ts:907-916`; 4 malformed-payload test cases |
| 6 | AGG-16 (touch-target Link/anchor gate) | c1a1227a | DONE — `touch-target-audit.test.ts` scans root `app/[locale]/*.tsx` + has `<Link>`/`<a>` FORBIDDEN patterns + synthetic-fail fixtures |
