# Plan 303 — Cycle 2 loop fixes (2026-04-25)

## Status: DONE

- 303-A — DONE (commit `6ad3b5b`)
- 303-B — DONE (commit `c143293`)
- 303-C — DONE (commit `67655cc`)

Quality gates: lint, lint:api-auth, lint:action-origin, vitest (61 files / 411 tests), tsc, build all green.

## Source

`_aggregate-cycle2-loop.md` cross-agent LOW findings, top-2 highest-confidence + cross-reviewer-agreement items. Both close the loop on cycle-1 plan-301's "single source of truth" intent for tag-label humanization and locale alternates.

## In-scope items

### 303-A — Apply `humanizeTagLabel` to photo-viewer chip render paths (AGG2L-LOW-01)

**Files:**
- `apps/web/src/components/photo-viewer.tsx:393-397` (desktop info-sidebar chip)
- `apps/web/src/components/info-bottom-sheet.tsx:241-245` (mobile bottom-sheet chip)

**Change:** Wrap the visible chip text with `humanizeTagLabel(tag.name)` so the photo-viewer chip renders the same humanized form as the masonry card / tag-filter / alt text / JSON-LD `name` (which already use the helper). Add the necessary import in each file.

After this:
- `tag.slug = "music_festival"`, `tag.name = "Music_Festival"` →
  - Masonry card: `#Music Festival` (already correct)
  - Tag-filter pill: `Music Festival` (already correct)
  - **Photo viewer desktop chip:** `#Music Festival` (fixed)
  - **Photo viewer bottom-sheet chip:** `#Music Festival` (fixed)

**Definition of done:**
- Both render paths route through `humanizeTagLabel`.
- The `humanizeTagLabel` JSDoc in `photo-title.ts:17-27` ("single source of truth … cannot drift from each other") is now literally true: every consumer flows through the helper.
- New unit test asserts that a tag with an underscore in its name produces a humanized chip label. (Implementation: a focused render-path test that imports the chip-rendering JSX or, alternatively, a helper-level "every tag-name render site uses `humanizeTagLabel`" smoke test using a regex scan, similar to other lint-style fixtures.)

### 303-B — Migrate root layout to `buildHreflangAlternates` (AGG2L-LOW-02)

**Files:**
- `apps/web/src/app/[locale]/layout.tsx:28-34`

**Change:** Replace the inline `{ 'en', 'ko', 'x-default' }` literal with `languages: buildHreflangAlternates(seo.url, '/')` and import the helper from `@/lib/locale-path`. Drop the explicit `'x-default': seo.url` because the helper emits its own `x-default` (pointing at `DEFAULT_LOCALE`).

This unifies the `x-default` semantics across the entire site (helper-emitted `…/en` for the home URL) and keeps the forward-compat promise that adding a new locale to `LOCALES` extends every hreflang map.

**Definition of done:**
- Root layout's `alternates.languages` value is `buildHreflangAlternates(seo.url, '/')`.
- No `'en':` / `'ko':` literals remain in `apps/web/src/app/**/layout.tsx` or `**/page.tsx` for hreflang use.
- Test: extend `apps/web/src/__tests__/locale-path.test.ts` (or add a small "metadata sweep" fixture test) to lock the layout's emission. Optional but recommended: a lint-style scanner mirroring `lint:action-origin`.

### 303-C — Test/scan to lock the consolidation (AGG2L test gap)

**Files:** `apps/web/src/__tests__/photo-title.test.ts` (extend) and/or `apps/web/src/__tests__/locale-path.test.ts` (extend)

**Change:** Add at least one assertion that, if any future contributor re-introduces a `#{tag.name}` raw-render or an `'en':` / `'ko':` literal in a hreflang map, the gate fails. Two reasonable forms:
1. **Render assertion (preferred for the chip case):** Mount the photo-viewer info-sidebar fragment with a tag named `Music_Festival` and assert the rendered text is `#Music Festival`. RTL-friendly. Keeps the test small.
2. **Source-grep fixture (acceptable):** A vitest test that reads `photo-viewer.tsx` and `info-bottom-sheet.tsx` source files and asserts no `#{tag.name}` raw match (regex). Matches the pattern used by `apps/web/src/__tests__/check-api-auth.test.ts` and `check-action-origin.test.ts`.

**Definition of done:**
- Re-introducing the bug fails CI.

## Out-of-scope (deferred to plan-304)

- AGG2L-LOW-03 (group-page masonry density). Designer call required; tracking-only this cycle.
- Plan-302 deferred items remain deferred per their original criteria.

## Risk assessment

- **303-A:** Mechanical wrap; behavior change only when tag name contains `_`. Tests cover.
- **303-B:** Mechanical helper substitution; behavior change is `x-default` value moves from `seo.url` to `localizeUrl(seo.url, DEFAULT_LOCALE, '/')`. This is the more semantically meaningful x-default ("English as the default version") and matches what the home / topic / photo pages already emit. Low risk.
- **303-C:** Test addition. No production risk.

## Estimated impact

- Resolves the cross-surface label-drift UX issue.
- Restores `humanizeTagLabel` JSDoc invariant.
- Restores `buildHreflangAlternates` JSDoc forward-compat invariant.
- Aligns `x-default` across the entire site (one URL, one signal to search engines).
- Adds a regression seatbelt against re-introduction.

## Order of operations

1. 303-A: wrap chip render paths in both files.
2. 303-B: migrate root layout to helper.
3. 303-C: add tests to lock both fixes.
4. Run all gates locally before each commit.
5. Fine-grained semantic commits, one per A/B/C task. GPG-sign all commits.
6. Push and `npm run deploy`.
