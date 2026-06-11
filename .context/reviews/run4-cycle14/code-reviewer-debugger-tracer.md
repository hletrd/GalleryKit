# Run-4 Cycle 14 — code-reviewer + debugger + tracer angles

NOTE: this cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c13). Each angle below was executed as a
distinct full-inventory in-context pass; no angle sampled.

## Inventory

1. **Independent line-level regression review of the cycle-13 fix commit**
   `414a8e18` (topics rename `map_visible` carry) + `c813f0a1` (SW bump).
2. **Rotation to the least-run-4-covered surfaces** by a fresh
   mention-count coverage map over run4-c1..c13 review texts (basename
   grep across all `.context/reviews/run4-cycle*/`): the **color /
   display-capability client cluster** — `components/color-details-section.tsx`
   (539 lines, full), `components/lightbox-color-pip.tsx` (284, full),
   `components/wide-gamut-hint.tsx` (209, full),
   `components/info-bottom-sheet.tsx` (color region),
   `lib/use-display-capability.ts` (136, full),
   `lib/icc-chromaticity.ts` (322, full), `lib/gain-map-detection.ts`
   (285, full), `lib/color-primaries.ts` (full),
   `lib/color-detection.ts` (signal-resolution region re-read),
   `components/histogram.tsx` (canvas/priority-chain region);
3. **Admin client rotation**: `password/password-form.tsx` +
   `password-client.tsx` + `actions/auth.ts` `updatePassword` (full),
   `tags/tag-manager.tsx` (full), `seo/seo-client.tsx` (structural),
   `analytics/analytics-client.tsx` (structural);
4. **Micro-libs**: `lib/image-zoom-math.ts`, `i18n/request.ts`,
   `lib/seo-og-url.ts`, `db/seed.ts`.
5. Pattern sweep: every consumer of wide-gamut primaries gating across
   `src/` (grep `isWideGamutPrimary` + `!== 'bt709'`).

## Regression review of cycle-13 commit — SOUND

`414a8e18` verified at line level against the current `topics` schema
(`db/schema.ts:4-12`: slug, label, order, image_filename, map_visible —
exactly 5 columns): the in-transaction SELECT now fetches
`slug + image_filename + map_visible` under the route lock, the
replacement INSERT carries all non-form columns, and
`nextImageFilename` is derived from the transaction row (closing the
pre-lock TOCTOU, COR-R4C13-02). The rename test pins the inserted VALUES
with an exact-object assertion. No drift, no follow-on work.

## Findings

### COR-R4C14-01 — ColorDetailsSection treats `'unknown'` primaries as wide gamut: raw enum leaks into the accordion label ("Color: unknown") and the accordion auto-opens for every ICC-less upload — MED / High (CONFIRMED)

**Files:**
- `apps/web/src/components/color-details-section.tsx:169-173` (isNonTrivialColor),
  `:221-229` (isWideGamut + accordionLabel)
- `apps/web/src/components/info-bottom-sheet.tsx:183-186` (isNonTrivialColor twin)

**Causal trace (tracer angle):**
1. `detectColorSignals` ALWAYS returns a `ColorSignals` object —
   `inferColorPrimaries(null)` returns `'unknown'` when the source has no
   ICC profile (`lib/color-detection.ts:58-70`), and neither NCLX nor ICC
   chromaticity rescues a profile-less JPEG/PNG.
2. `uploadImages` persists it verbatim: `color_primaries:
   data.colorSignals?.colorPrimaries ?? null` (`app/actions/images.ts:352`)
   — so every untagged upload (exports without embedded profiles,
   screenshots, messaging-app re-saves) stores the string `'unknown'`.
3. `color_primaries` is a PUBLIC field (`lib/data.ts` publicSelectFields
   does not omit it — by design, it powers the public gamut badges).
4. `ColorDetailsSection` line 221: `const isWideGamut =
   Boolean(image.color_primaries) && image.color_primaries !== 'bt709'`
   → `'unknown'` passes. Line 222: `gamutLabel = primariesHuman ??
   image.color_primaries ?? ''` → `humanizeColorPrimaries('unknown')`
   returns null → `gamutLabel = 'unknown'` (raw enum). Line 228: label =
   `t('viewer.colorDetailsWithGamut', { gamut: 'unknown' })` →
   **"Color: unknown"** (EN) / **"색상: unknown"** (KO, half-translated).
5. Line 169-173: the same ad-hoc check makes `isNonTrivialColor` true →
   the accordion **auto-opens** for these trivial-color photos for public
   visitors (admins additionally auto-open via the `srgb-from-unknown`
   decision branch, which IS intended per CLAUDE.md).

**Why it is a problem:** the accordion label is the photographer-craft
headline on the photo viewer + mobile bottom sheet. For the extremely
common untagged-source case it (a) leaks an internal enum value as
user-facing copy, (b) mixes locales on KO ("색상: unknown"), and (c)
claims gamut significance ("Color: X" framing) for a photo whose gamut is
precisely NOT known. The codebase already has the canonical predicate for
this: `isWideGamutPrimary()` in `lib/color-primaries.ts`, whose docstring
says the source of truth must live there because "adding a new wide-gamut
primary in only ONE call site silently breaks the others". Every sibling
consumer uses it (`histogram.tsx:190,478`, `home-client.tsx:352`,
`image-manager.tsx:499`, `info-bottom-sheet.tsx:179`,
`photo-viewer.tsx:227`, `wide-gamut-hint.tsx:148`,
`actions/images.ts:296`) — `color-details-section.tsx` and the
`isNonTrivialColor` arm of `info-bottom-sheet.tsx` are the only two
ad-hoc re-implementations left, and both mis-handle `'unknown'`.
A third local variant at `color-details-section.tsx:454` /
`lightbox-color-pip.tsx:207` (`!== 'bt709' && !== 'unknown'`) handles
`'unknown'` correctly but triplicates the predicate.

**Concrete failure scenario:** photographer exports a JPEG from a tool
that strips the ICC profile (or uploads a phone screenshot for a blog
header). The public photo page renders the accordion OPEN with the
header "Color: unknown"; on the Korean locale the header is
"색상: unknown". A visitor reads this as a glitch; the photographer
reads it as the gallery shaming their export settings.

**Fix:** import `isWideGamutPrimary` from `@/lib/color-primaries` in
both components; use it for `isWideGamut` (label gate) and for the
primaries arm of `isNonTrivialColor` in both files. `'unknown'`-primaries
photos then render the static "Color details" label, default-closed for
public viewers, while the inner "Color primaries: Unknown" row (already
correctly localized via `humanizeColorPrimaries → viewer.colorUnknown`)
still surfaces the honest unknown state to anyone who expands. Admin
default-open via the `srgb-from-unknown` decision branch is unchanged.
Lock with a source-fixture test (repo convention) asserting both files
gate via `isWideGamutPrimary(` and contain no remaining
`color_primaries !== 'bt709'` ad-hoc comparisons outside the
delivered-row decision derivation.

### COR-R4C14-02 — gain-map heuristic-1 `tmap`+URN branch is dead code (comment claims behavior the parser cannot deliver) — LOW / High (CONFIRMED)

**File:** `apps/web/src/lib/gain-map-detection.ts:251-257` vs `:133`.

`parseInfe` only parses `item_uri` when `itemType === 'urim'`
(line 133), so `entry.itemUri` is ALWAYS null for `'tmap'` entries —
the heuristic-1 branch "flag `tmap` immediately when it carries the
Apple HDR gain-map URN" (lines 252-255, R5-M3 comment) can never fire.
All `tmap` detection flows through heuristic 2 (auxl iref), which the
R5-M3 fixture tests lock (tmap+auxl detected; standalone tmap not).
Behavior matches the tests, so this is purely a dead branch + an
overstated comment — but a future reader extending URN handling will
trust the comment and miss that the URI is never populated. Fix: parse
`item_uri` for `tmap` items too (`itemType === 'urim' || itemType ===
'tmap'` at line 133), making the code match the documented R5-M3
intent; per ISO 21496-1 `tmap` items do not carry URI strings in
practice, so shipping behavior is unchanged and the locked tests stay
green.

### RISK-R4C14-03 — iOS 17+ ISO 21496-1 gain maps whose `tmap` is referenced only via `dimg` may evade both heuristics — MED impact / Low confidence (NEEDS MANUAL VALIDATION)

**File:** `apps/web/src/lib/gain-map-detection.ts:274-282`.

Heuristic 2 only inspects `auxl` references and requires the TARGET to
be `urim`/`tmap`-typed. Real-world Apple iOS 17/18 HDR HEICs (per
public exiftool structure dumps) commonly ship: `tmap` derived item
referencing `[primary, gainmap]` via **`dimg`**, with `auxl` pointing
gainmap(hvc1) → primary(hvc1) — neither an `auxl` ref TO a tmap item
nor a urim URN. If that is the shipping shape, `has_gain_map` would
under-report on exactly the files the feature was built for. Cannot be
confirmed without a real iOS 17+ fixture file (the repo's synthetic
fixtures model the auxl→tmap shape). Impact is contained: admin-only
audit row, fail-quiet direction. Recommend: acquire a real fixture and,
if confirmed, extend heuristic 2 to treat a `dimg` reference FROM a
`tmap` item as a gain-map signal. Not schedulable this cycle without
the fixture; record as deferred with an explicit exit criterion.

## Clean-pass surfaces (code/debugger/tracer angles)

- `lib/use-display-capability.ts` — snapshot memoization correct
  (value-compare before reference swap; React #185 invariant held);
  subscribe/unsubscribe pairs complete; SSR default documented.
- `lib/icc-chromaticity.ts` — all reads bounds-checked; tag-table walk
  capped (100 tags / 4 KB); `chad` inversion guarded (det ≥ 1e-12,
  finite checks); `xyzToXy` zero-sum guard; no NaN escape paths.
- `lib/image-zoom-math.ts` — trivial, clamps correct.
- `i18n/request.ts` — locale allowlist fallback correct.
- `lib/seo-og-url.ts` — same-origin enforcement with `//` rejection.
- `actions/auth.ts updatePassword` — validation precedes rate-limit
  pre-increment (C9R order held); session rotation transactional.
- `tag-manager.tsx` / `seo-client.tsx` / `analytics-client.tsx` — no
  correctness defects (one dead-UI-state UX nit recorded by designer).
- `lightbox-color-pip.tsx` — handles `'unknown'` correctly via
  `humanizeColorPrimariesOrLabel` (localized "Unknown"); the
  delivered-row local predicate handles `'unknown'` correctly.

## Confidence labels

- COR-R4C14-01: **High** — confirmed by full data-flow trace
  (detection → persistence → public select → render).
- COR-R4C14-02: **High** — dead branch confirmed by reading both sites.
- RISK-R4C14-03: **Low** — depends on unverifiable real-file shape.
