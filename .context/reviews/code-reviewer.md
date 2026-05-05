# Cycle 4 Review — Comprehensive Single-Agent Review

**Scope**: Full codebase review following cycles 1–3 implementation. Focus on recent commits
(`3bbb252` reaction removal, `b4323fe` image-zoom/photo-viewer UX, `f4d402f` lightbox flicker fix)
and their cross-file impacts.

**Agent Note**: No review-agent infrastructure (`Agent` tool, `.claude/agents/`) was registered in
this environment. This review was performed manually by examining all affected files and running
every configured quality gate.

---

## C4R-08: TypeScript build errors — `reactionsEnabled` prop passed to removed interface
**Severity**: High | **Confidence**: High | **Type**: correctness / regression

**Files**:
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, line 160
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, line 126

**Problem**: Commit `3bbb252` removed `reactionsEnabled` from `PhotoViewerProps` in
`photo-viewer.tsx`, but the shared-group page (`g/[key]/page.tsx`) and shared-link page
(`s/[key]/page.tsx`) still pass `reactionsEnabled={false}` (or similar) to `<PhotoViewer>`.
This causes `tsc --noEmit` to fail with:

```
Property 'reactionsEnabled' does not exist on type 'IntrinsicAttributes & PhotoViewerProps'
```

**Failure scenario**: The app cannot build for production. Any CI pipeline running `npm run build`
(or `npm run typecheck`) will fail.

**Fix**: Remove the `reactionsEnabled` prop from both `<PhotoViewer>` call sites.

---

## C4R-07: Unit test regression — `wheelStep` factor changed without updating tests
**Severity**: High | **Confidence**: High | **Type**: correctness / test drift

**Files**:
- `apps/web/src/lib/image-zoom-math.ts`, line 28 (changed from `0.9 / 1.1` to `0.95 / 1.05`)
- `apps/web/src/__tests__/image-zoom-math.test.ts`, lines 70–77

**Problem**: Commit `b4323fe` reduced the zoom wheel-step factor from 10 % to 5 % (0.95/1.05),
but the corresponding unit tests still assert the old 10 % behavior:
- `expect(wheelStep(2.0, 100)).toBeCloseTo(1.8)` — now returns 1.9
- `expect(wheelStep(2.0, -100)).toBeCloseTo(2.2)` — now returns 2.1

**Failure scenario**: `npm test` fails every run. This is a blocking gate regression.

**Fix**: Update the two test expectations to match the new 5 % step (1.9 and 2.1 respectively),
or revert the factor change if the 10 % step was intentional.

---

## C4R-01: Reaction feature removal is incomplete — dead code remains across stack
**Severity**: Medium | **Confidence**: High | **Type**: maintainability / dead code

**Problem**: Commit `3bbb252` stripped the heart/like UI from `photo-viewer.tsx` and `lightbox.tsx`,
but the backend and configuration surface for reactions was left intact. This creates confusion
for admins (a settings toggle that does nothing) and leaves unmaintained code paths.

**Affected files/regions**:
- `apps/web/src/app/api/reactions/[imageId]/route.ts` — entire API route still serves GET/POST
- `apps/web/src/lib/reaction-rate-limit.ts` — entire rate-limit module still imported by the route
- `apps/web/src/db/schema.ts` — `imageReactions` table and `images.reaction_count` column still exist
- `apps/web/src/lib/gallery-config-shared.ts` — `reactions_enabled` in `GALLERY_SETTING_KEYS`, `DEFAULTS`, and `VALIDATORS`
- `apps/web/src/lib/gallery-config.ts` — `reactionsEnabled: boolean` still in `GalleryConfig` type
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` — entire Reactions card still rendered (lines 195–221)
- `apps/web/messages/en.json` — `settings.reactionsTitle`, `settings.reactionsDesc`, `settings.reactionsEnabled`, `settings.reactionsEnabledHint`, `reaction.*`
- `apps/web/messages/ko.json` — same keys as above
- `apps/web/src/components/home-client.tsx` — `GalleryImage.reaction_count?: number | null` and aria-label append logic (lines 69, 207–210)
- `apps/web/src/components/map/map-client.tsx` — `gallery_auto_lightbox` sessionStorage key still set on marker click

**Failure scenario**: An admin toggles "Enable Reactions" in settings, expecting the heart button
to appear on photos. Nothing happens. The dead code also increases bundle size (unused translations),
migration surface (unused DB table/column), and attack surface (unused public API route with cookie handling).

**Fix**: Either (a) fully remove all reaction infrastructure (DB table, column, API route,
rate-limit module, config keys, translations, admin UI, aria-label references), or (b) restore
the UI if the removal was accidental. Given the commit message says "remove like/reaction feature",
option (a) is the intended fix.

---

## C4R-05: Admin settings page renders a dead "Reactions" card
**Severity**: Low | **Confidence**: High | **Type**: UX / dead UI

**File**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, lines 195–221

**Problem**: The Reactions settings card with a Heart icon and a toggle switch is still rendered
in the admin dashboard, even though the photo viewer no longer shows reactions. The toggle has
no user-visible effect.

**Failure scenario**: Admin confusion; wasted vertical space in settings page.

**Fix**: Remove the Reactions card block from the settings client.

---

## C4R-03: `home-client.tsx` declares and references unfetched `reaction_count`
**Severity**: Low | **Confidence**: High | **Type**: dead code / a11y drift

**File**: `apps/web/src/components/home-client.tsx`, lines 69 and 207–210

**Problem**: The `GalleryImage` interface includes `reaction_count?: number | null`, and the
masonry card `aria-label` logic appends a reaction count string when `image.reaction_count > 0`.
However, `adminSelectFields` in `lib/data.ts` (which drives the public queries via
`publicSelectFields`) does NOT include `reaction_count`. Therefore the field is always
`undefined`/`null` at runtime, and the reaction-count branch of the aria-label is never reached.
The code is effectively dead.

**Failure scenario**: Screen-reader users never hear reaction counts (which is fine since the
feature is removed), but the dead code creates maintenance burden and misleading type contracts.

**Fix**: Remove `reaction_count` from the `GalleryImage` interface and the conditional aria-label
append logic.

---

## C4R-02: Orphaned i18n translation keys for reactions
**Severity**: Low | **Confidence**: High | **Type**: i18n / dead strings

**Files**:
- `apps/web/messages/en.json`, lines 604–607, 617–625
- `apps/web/messages/ko.json`, equivalent keys

**Problem**: Translation keys for reaction UI remain in both language files even though no
component renders them anymore.

**Failure scenario**: Bundle bloat (minor), translator confusion if new locales are added.

**Fix**: Remove all `settings.reactionsTitle`, `settings.reactionsDesc`, `settings.reactionsEnabled`,
`settings.reactionsEnabledHint`, and `reaction.*` keys.

---

## C4R-04: `gallery-config-shared.ts` still validates the `reactions_enabled` setting
**Severity**: Low | **Confidence**: High | **Type**: maintainability / dead config

**File**: `apps/web/src/lib/gallery-config-shared.ts`, lines 24, 69, 95

**Problem**: `reactions_enabled` is still present in `GALLERY_SETTING_KEYS`, `DEFAULTS`, and
`VALIDATORS`. The `GalleryConfig` type in `gallery-config.ts` also still exposes `reactionsEnabled: boolean`.

**Fix**: Remove `reactions_enabled` from all three config structures. Remove `reactionsEnabled`
from `GalleryConfig` type.

---

## C4R-06: Image-zoom cursor changed from `cursor-zoom-in` to `cursor-auto`
**Severity**: Low | **Confidence**: Medium | **Type**: UX / affordance

**File**: `apps/web/src/components/image-zoom.tsx`, line 315

**Problem**: Commit `b4323fe` changed the non-zoomed cursor from `cursor-zoom-in` to `cursor-auto`.
This removes the visual hint that clicking the image will zoom. Users may not discover the zoom
feature without the magnifying-glass cursor.

**Failure scenario**: Users on desktop miss the zoom capability because there's no visual cue.

**Fix**: Either restore `cursor-zoom-in` or add an explicit zoom button/hint.

---

## AGENT FAILURES

No agent failures — the `Agent` tool was not registered in this environment, so the review was
performed manually by the cycle subagent.
