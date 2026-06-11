# Run-4 Cycle 15 — code-reviewer + debugger + tracer angles

NOTE: this cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c14). Each angle below was executed as a
distinct full-inventory in-context pass; no angle sampled.

## Inventory

1. **Independent line-level regression review of the cycle-14 fix
   commits** `b7877c8c` (isWideGamutPrimary gating), `beb5c64f`
   (tmap+URN branch), `82e35324` (tag delete dialog), `343eb9ae`
   (SW bump) — each verified against the canonical helper semantics
   and the Radix AlertDialog close model.
2. **Rotation to the least-run-4-covered surfaces** by a fresh
   mention-count coverage map over run4-c1..c14 review texts (basename
   grep across `.context/reviews/run4-cycle*/`). The zero-coverage set
   this cycle — **app shell / error / navigation cluster**:
   `app/[locale]/layout.tsx` (155, full), `(public)/layout.tsx`,
   `admin/layout.tsx`, `admin/(protected)/layout.tsx`,
   `app/[locale]/not-found.tsx`, `app/[locale]/error.tsx`,
   `admin/(protected)/error.tsx`, `app/global-error.tsx` (83, full),
   `components/nav.tsx`, `nav-client.tsx` (172, full),
   `admin-nav.tsx`, `admin-header.tsx`, `footer.tsx`,
   `theme-provider.tsx`, `i18n-provider.tsx`, `lazy-focus-trap.tsx`,
   `app/icon.tsx`, `app/apple-icon.tsx`, all three `loading.tsx`
   surfaces + `photo-viewer-loading.tsx`;
3. **Micro-lib rotation** (zero/one coverage): `lib/image-types.ts`,
   `lib/clipboard.ts`, `lib/theme.ts`, `lib/safe-json-ld.ts`,
   `lib/photo-title.ts`, `lib/bounded-map.ts`, `lib/upload-paths.ts`,
   `lib/upload-filenames.ts`, `lib/password-hashing.ts`,
   `lib/color-pipeline-decisions.ts`, `lib/constants.ts`,
   `lib/utils.ts`, `lib/hdr-filenames.ts`, `lib/bulk-edit-types.ts`,
   `lib/clip-embeddings.ts`, `lib/clip-inference.ts`,
   `lib/db-restore.ts`, `lib/sql-restore-scan.ts`,
   `lib/download-interstitial.ts`, `lib/error-shell.ts`;
4. **Storage + map + filter cluster**: `lib/storage/types.ts`,
   `lib/storage/local.ts` (full traversal/containment audit),
   `components/map/map-loader.tsx`, `components/map/map-client.tsx`
   (full), `app/[locale]/(public)/map/page.tsx`,
   `components/tag-filter.tsx` (full), `topic-empty-state.tsx`,
   `app/[locale]/admin/login-form.tsx`;
5. Pattern sweeps: `min-h-\[NNpx\]` sub-44 values across scan roots;
   `dangerouslySetInnerHTML` / suppression-comment sweep over
   `components/ui/*` (vendored shadcn primitives) — zero hits.

## Regression review of cycle-14 commits — SOUND

- `b7877c8c`: `isWideGamutPrimary` (`lib/color-primaries.ts:46-49`)
  returns `false` for `null`/`undefined`/`'unknown'`/`'bt709'` and
  `true` only for the five WIDE_GAMUT_PRIMARIES members — exactly the
  semantics the four swapped call sites need. The delivered-row
  derivations changed `!== 'bt709' && !== 'unknown'` →
  `isWideGamutPrimary(...)`: equivalent over the persisted enum domain
  (`ColorPrimariesValue`), strictly safer for out-of-domain strings.
- `beb5c64f`: `parseInfe` reads the trailing URI for `tmap` items;
  bounds (`pos < dataEnd`) preserved; behavior for `urim` unchanged.
- `82e35324`: `preventDefault()` suppresses Radix auto-close;
  `handleDelete` catches internally (toast on error) so the `await`
  always settles and `setDeleteId(null)` runs; `onOpenChange` guard +
  disabled Cancel make ESC/overlay inert mid-flight. No leak: if
  `handleDelete` somehow threw, `isDeleting` resets in its `finally`,
  leaving the dialog open but closable — acceptable.

## Findings

### COR-R4C15-01 — `global-error.tsx` renders the LIGHT error shell for OLED-theme users: `detectDarkMode()` only knows the `dark` class — MED(LOW)/High (CONFIRMED)

**File:** `apps/web/src/app/global-error.tsx:44-47` (detectDarkMode), `:61` (`<html className={isDark ? 'dark' : undefined}>`)

**Causal trace (tracer angle):**
1. The theme system ships FOUR themes: `ThemeProvider` in
   `app/[locale]/layout.tsx:122-130` passes
   `themes={['system','light','dark','oled']}` with `attribute="class"`
   and `storageKey="gallery_theme"`. next-themes applies the theme name
   as the `<html>` class — `oled` mode puts class **`oled`** (not
   `dark`) on the document element. `globals.css:70` defines `.oled`
   (`--background: 0 0% 0%` true black) as a sibling of `.dark`.
2. `detectDarkMode()` checks only `classList.contains('dark')` → for
   an OLED-mode visitor it returns `false`.
3. `GlobalError` renders a fresh `<html>` with NO theme class → every
   token resolves through `:root` (light theme) → **a blinding white
   fatal-error page for a user whose entire session was true black**.
   This defeats the precise purpose of the existing dark detection
   (the component already bothers to preserve theme fidelity — it just
   models a 2-theme world in a 4-theme system).
4. The sibling helper `resolveErrorShellBrand` was extracted to
   `lib/error-shell.ts` exactly so this surface could be unit-tested
   (`__tests__/error-shell.test.ts`); the theme-class detection never
   got the same treatment and has zero test coverage.

**Failure scenario:** photographer demos the gallery on an OLED display
in a dark room (the exact audience the `oled` theme exists for); a
fatal render error fires; the screen flashes full white.

**Fix:** extract a pure `resolveErrorShellThemeClass(documentLike)` into
`lib/error-shell.ts` returning `'oled' | 'dark' | null` (checks `oled`
first, then `dark`), use it in `global-error.tsx`
(`<html className={themeClass ?? undefined}>`), and lock both classes +
the null fallback in `error-shell.test.ts`. Confidence High.

### PERF-R4C15-02 — map popup downloads the FULL-RESOLUTION base JPEG for a 120×80 thumbnail; also bypasses `imageUrl()`/CDN — MED/High (CONFIRMED)

**File:** `apps/web/src/components/map/map-client.tsx:91-99`;
`components/map/map-loader.tsx` (no `imageSizes` prop);
`app/[locale]/(public)/map/page.tsx` (doesn't fetch gallery config)

See perf-reviewer-architect.md for the full analysis. Code angle
concurs: the `<img src={'/uploads/jpeg/' + marker.filename_jpeg}>`
literal is the ONLY image surface in `src/` that builds an upload URL
without going through `imageUrl()`/`sizedImageUrl()` — so beyond the
full-res download it also breaks `IMAGE_BASE_URL` CDN-fronted
deployments for exactly this one surface (silent origin-hit or 404
depending on CDN config). The established fallback pattern for sized
derivatives is in `components/search.tsx` `SearchResultItem`
(R23-M1, mirroring R21-M1/R22-M1): sized URL first, one-shot `onError`
swap to the base filename (encoder atomic-rename contract guarantees
the base exists).

### DES-R4C15-03 / DES-R4C15-04 / DES-R4C15-05 / DES-R4C15-06

Touch-target and ARIA findings on `tag-filter.tsx`, `admin-nav.tsx`,
`footer.tsx`, `admin/(protected)/error.tsx` — see designer.md (code
angle concurs with all four; the tag-filter case is also a
test-engineer finding because the violation shape evades every
FORBIDDEN pattern in the audit).

### OBS-R4C15-A — `p/[id]/loading.tsx` lazy sessionStorage read can mismatch SSR'd fallback HTML — LOW/Low (NEEDS VALIDATION, defer)

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:16`

`useState(readLightboxFlag)` initializes from `sessionStorage` on the
client while the server always renders the non-lightbox branch. On a
hard load of `/p/[id]` with `gallery_auto_lightbox=true` still set
(e.g. the prior navigation was interrupted before the viewer consumed
the flag), hydration of the streamed Suspense fallback would mismatch
(white viewer skeleton vs black lightbox spinner). Bounded blast
radius: React re-renders the fallback client-side; the flag is
consumed/cleared by the viewer in the normal flow, so the stale-flag
hard-load window is narrow. No fix scheduled — recording as a deferred
observation with an exit criterion (see plan-302).

## Clean-pass surfaces (code angle)

`bounded-map.ts` (collect-then-delete prune; insertion-order eviction
documented in CLAUDE.md), `upload-paths.ts` (env-root resolution +
legacy-dir guard), `upload-filenames.ts` (byte-budget bound),
`password-hashing.ts` (shared Argon2id params), `clip-embeddings.ts` /
`clip-inference.ts` (stub determinism, bounds-checked buffer
round-trip), `storage/local.ts` (normalizeStorageKey rejects
`..`/absolute/empty segments; `path.resolve` containment with
`+ path.sep`; lstat symlink rejection on read stream; `getUrl` blocks
`original/`), `sql-restore-scan.ts` (conditional-comment unwrap before
literal masking; tail-window chunking), `db-restore.ts`,
`download-interstitial.ts` (POST-only claim; full HTML escaping; no
token in body), `login-form.tsx` (visibility toggle preserves value;
44px toggle; autocomplete attrs), `theme.ts` (`nextTheme` handles
unknown via indexOf -1 → 'system'), `image-types.ts`
(`formatShutterSpeed` exact-fraction guard), `photo-title.ts`,
`safe-json-ld.ts`, `clipboard.ts` (selection/focus restoration),
layouts ×4 (auth chrome gating C1R-03 verified; skip links wired to
`tabIndex={-1}` targets), `not-found.tsx`, `error.tsx` (public),
loading ×3 + `photo-viewer-loading.tsx` (role="status" + labels),
`icon.tsx` / `apple-icon.tsx`, `nav.tsx` / `nav-client.tsx`
(matchMedia listener cleanup; rAF cancel; cookie attrs on locale
switch), `admin-header.tsx`, `theme-provider.tsx`,
`i18n-provider.tsx`, `lazy-focus-trap.tsx`, `topic-empty-state.tsx`,
`components/ui/*` drift scan (no suppressions, no
dangerouslySetInnerHTML, no sub-44 size literals).
