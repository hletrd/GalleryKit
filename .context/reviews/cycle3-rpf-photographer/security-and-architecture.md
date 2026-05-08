# Cycle 3 RPF — Security, Architecture, Test-Coverage, Critic Review

**Date:** 2026-05-08
**Reviewer perspective:** OWASP / architectural symmetry / test gaps / multi-perspective critique, all from the **photographer-perspective use case**.
**Predecessor reviews:** `.context/reviews/photographer-r3/`, `.context/reviews/cycle2-rpf-photographer/security-and-architecture.md`.

---

## Security recap (photographer-axis only)

The repository's general security posture is mature (Argon2 sessions, HMAC tokens, withAdminAuth + requireSameOriginAdmin lint gates, advisory locks for restore/upload-contract/topic-rename/admin-delete/per-image-claim, CSV escape against Trojan-Source, validation rejects Unicode bidi overrides on admin string fields). The photographer-relevant security surface:

- `is_hdr` / `transfer_function` / `matrix_coefficients` / `color_pipeline_decision` admin-only via `_PrivacySensitiveKeys` compile-time guard + `map-privacy.test.ts` runtime test (cycle-2 C2-A1).
- GPS coordinates omitted from `publicSelectFields`. `publicMapSelectFields` strict superset of `publicSelectFields` only at GPS keys.
- `filename_original` and `user_filename` PII-fields omitted from public.
- Symlink rejection on uploads. Decompression-bomb mitigation (`limitInputPixels`).
- `getSafeExtension` whitelist for upload extensions.
- HDR ingest rejected by default (`P3-2`); admin opt-in.
- All admin API routes wrapped in `withAdminAuth` (lint enforced).
- All mutating server actions return-early on `requireSameOriginAdmin` result (lint enforced).

**No new security finding this cycle.** Cycle-2 verification holds.

---

## Findings (cycle 3)

### MED (2)

#### C3-ARCH-MED-1 — `getGalleryConfig` returns admin-only fields to public consumers

**Files:** `apps/web/src/lib/gallery-config.ts:74-95`, callers across `apps/web/src/app/[locale]/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, etc.
**Severity:** MED.
**Confidence:** HIGH.

The `GalleryConfig` interface exposes admin-tunable fields like `allowHdrIngest`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `avifEffort`. These are read by:

- The image queue (server-side; OK).
- Server-side render of the photo viewer (sets `forceShowColorChips` on the page) — OK.
- Admin settings UI (admin-side; OK).

The concern: `getGalleryConfig()` is a thin Drizzle read on `gallery_config`. Public-page renders may pass `forceShowColorChips` to the client, which is intentional. But there is no compile-time / lint-time enforcement that **other** admin-only knobs (e.g. `forceSrgbDerivatives`) don't accidentally leak to the client. A future contributor could accidentally pass the entire `config` object to a client component.

Today: spot-check confirms no leak. `forceShowColorChips` is the only field passed to client; other knobs stay server-side. But the surface is wide.

**Fix shape:** define two interfaces — `GalleryConfigServer` (full set, server-only) and `GalleryConfigClient` (subset surfaced to client; just `forceShowColorChips` and other public-rendering fields). `getGalleryConfig()` returns the server interface; a separate `getGalleryConfigForClient()` projects to the client subset. Lint or test rule: no client component imports `GalleryConfigServer`.

**Photographer impact:** none today. Defense in depth against future drift.

#### C3-ARCH-MED-2 — `WIDE_GAMUT_PRIMARIES` set is duplicated across 4 sites

**Files:** `apps/web/src/components/photo-viewer.tsx:194` (inline array), `apps/web/src/lib/process-image.ts:688` (via `resolveAvifIccProfile`), `apps/web/src/components/histogram.tsx:41` (Set), `apps/web/src/app/actions/images.ts:273` (Set).
**Severity:** MED.
**Confidence:** HIGH.

Duplicate of `C3-COL-LOW-1` from a different angle (architecture). Adding a new wide-gamut primary requires touching 4 files. Each site uses a slightly different shape (array vs Set). The semantics are identical, but no shared definition.

**Fix shape:** centralize. Already covered in `C3-COL-LOW-1`; this entry escalates to MED severity from the architectural angle because **drift in any one site silently breaks photographer-intent on that path** (e.g. if `process-image.ts` is the only site to add `'rec2100'`, the histogram will not consider rec2100 as wide-gamut and will choose the wrong AVIF source for canvas-P3 probing).

**Photographer impact:** silent drift if a future maintainer adds a primary at one site only. Bounded by the rarity of new primaries (last addition was DCI-P3, ~2 cycles ago).

---

### LOW (3)

#### C3-TEST-LOW-1 — No fixture test for `parseCicpFromHeif` against real binary HEIF

**Files:** `apps/web/__test_fixtures__/color/` (missing), `apps/web/src/__tests__/color-detection.test.ts`.
**Severity:** LOW.
**Confidence:** HIGH.

Carry-forward from cycle 2 `C2-TEST-MED-1` (deferred to plan 41). Today's tests synthesize NCLX boxes manually in `color-detection.test.ts` — they verify the parser logic but don't catch real-world HEIF formatter quirks (Apple ProRAW, Sony α7 IV HLG, Canon C-Log, Nikon Z9 N-Log).

**Fix shape:** add a small (≤50 KB) PQ HEIF fixture + HLG HEIF fixture to `apps/web/__test_fixtures__/color/`, generated via `avifenc --cicp 9/16/9` over a 64×64 synthetic image. Add tests that call `parseCicpFromHeif(buffer)` on the real bytes and assert the triplet matches.

**Photographer impact:** none directly. Closes the regression surface for real-world HEIF parsing.

#### C3-TEST-LOW-2 — No end-to-end test for `force_srgb_derivatives` flow

**Files:** `apps/web/src/__tests__/force-srgb-derivatives.test.ts` (component-level), missing E2E.
**Severity:** LOW.
**Confidence:** MEDIUM.

The setting is admin-only and rarely toggled. A full E2E test would (a) seed `gallery_config.force_srgb_derivatives=true`, (b) upload a P3-tagged source, (c) read the resulting AVIF/WebP/JPEG ICC tags, (d) assert WebP/JPEG are sRGB-tagged and AVIF is P3-tagged (per `C3-COL-MED-3` documented behavior).

Cycle 2 deferred this. Cycle 3 keeps the deferral.

**Photographer impact:** trivial. Setting is admin-rare.

#### C3-DEBUG-LOW-1 — `getAvifSupported` and `getSupportsCanvasP3` return value during the first wide-gamut histogram render flips between renders

**File:** `apps/web/src/components/histogram.tsx:44-67, 304-309`.
**Severity:** LOW.
**Confidence:** MEDIUM.

The first wide-gamut histogram render in a session sees `_cachedAvifSupported = null → false` (synchronous return false; AVIF probe pending). The next render (after the `<img>.onload` fires) sees `true`. The component re-renders only if React knows to invalidate; today there's no state tied to the cached probe, so the histogram will re-evaluate `preferAvif` only when a different effect triggers a re-render.

In practice the photo's `<Image>` triggers a re-render on load, so the histogram catches up on the second render. But a tight failure mode exists where the histogram renders the SDR clipped variant + "(sRGB clipped)" hint, and never updates because no other state changes.

**Fix shape:** convert to async Promise-singleton (matching the rgb16 probe pattern) + a state hook that triggers re-render when the probe resolves. Already covered in `C3-COL-LOW-2`.

---

### Critic-pass commentary

The codebase has reached a defensible photographer-perspective state. Cycle 3 review-only, reading the code as-is on master HEAD `e07730dd`:

- The 4 photographer priority axes (color, HDR, gamut, ICC) are all closed at the CRIT/HIGH level. Findings cluster at MED (architectural symmetry, locale coverage, lightbox HDR badge) and LOW (admin tunables polish, disk hygiene, test fixture coverage).
- The deferred queue from cycle 2 is intact. Plan 40 archived candidacy (all items shipped). Plan 38 still has long-tail open items (P3-12 fixtures, P3-13 ICC TRC HDR, P3-29 Korean spot-checks, P3-33 polish).
- No NEW CRIT or HIGH this cycle.
- Architectural symmetry: bottom-sheet ↔ sidebar ref-binding gap is the highest-signal architectural finding (C3-UX-MED-1). Plan 41 — or a focused refactor commit — should land it.
- Locale coverage: `humanizeColorPrimaries` / `humanizeTransferFunction` are English-only; lightbox pip mixes locales. C3-COL-MED-1 / C3-COL-MED-2 / C3-UX-MED-3 converge on this.

Recommended cycle-3 implementation queue (mostly XS/S):

1. **C3-COL-MED-1 + C3-UX-MED-3** — convert `humanizeTransferFunction` to take `t`; add localized keys; update lightbox pip and color-details-section. (S)
2. **C3-COL-LOW-1 / C3-ARCH-MED-2** — centralize `WIDE_GAMUT_PRIMARIES` in `lib/color-detection.ts`. (XS)
3. **C3-UX-MED-2** — add HDR badge to lightbox color pip expanded panel. (XS)
4. **C3-COL-LOW-2 / C3-DEBUG-LOW-1** — make `getAvifSupported` Promise-singleton + state hook. (S)
5. **C3-COL-LOW-4** — remove redundant `eslint-disable-next-line` comments on `_omit*` discards (verify ESLint passes without them via `varsIgnorePattern: '^_'`). (XS)
6. **C3-INT-MED-1** — narrow chroma-subsampling type end-to-end (admin-config → gallery-config → process-image params). (S)
7. **C3-UX-MED-1 / C3-UX-LOW-2** — hoist Color Details + Histogram state to `PhotoViewer`; remove ref dance; eliminate `colorDetailsId` collision. (M — defer to plan 41 if time-bound)

The first 5 are XS/S effort and ship in this cycle. Item 6 is single-file type narrowing. Item 7 is the larger architectural refactor; defer if cycle-3 time pressure is tight.

---

## Convergent findings (cross-angle)

| Finding | Angles | Signal |
|---|---|---|
| Locale coverage of color humanizers | color-fidelity (C3-COL-MED-1, C3-COL-MED-2) + ui-ux-photographer (C3-UX-MED-3) | HIGH (3 angles agree) |
| Wide-gamut primaries duplication | color-fidelity (C3-COL-LOW-1) + architecture (C3-ARCH-MED-2) | HIGH (2 angles, MED escalation) |
| Bottom-sheet ↔ sidebar ref binding | ui-ux-photographer (C3-UX-MED-1) + architecture (implicit) | HIGH (carry-forward; same finding two cycles in a row) |
| canvas-P3 / AVIF probe first-render flicker | color-fidelity (C3-COL-LOW-2) + debug (C3-DEBUG-LOW-1) | MEDIUM |

---

## AGENT FAILURES

No subagent reviewers are registered in this environment beyond the local `~/.claude/agents/perf-reviewer.md`. Per the cycle brief, the multi-angle review is performed by the orchestrator across photographer-perspective angles. No silent agent failures occurred.

---

## Provenance

Cycle-3 RPF security / architecture / test / debug / critic angle. Single-orchestrator focused pass.
