# Plan 302 — Run-4 Cycle 15 deferred ledger

**Source review:** `.context/reviews/run4-cycle15/_aggregate.md`
**Status:** RECORDED (deferred items only — nothing here is scheduled
for this cycle; severities preserved from the review, not downgraded)

Repo-rule basis for deferral (read before deferring, per the loop's
deferred-fix rules): CLAUDE.md permits deferral for non-security /
non-correctness / non-data-loss items when a concrete exit criterion
is recorded (established ledger convention plan-274 → plan-300; the
items below are availability/UX-scale observations and a Low-confidence
hydration note — none is a security, correctness-with-user-impact, or
data-loss finding). Deferred work remains bound by repo policy when
picked up (GPG-signed commits, conventional commits + gitmoji,
per-cycle gates, no suppressions).

## DEF-R4C15-A — `getMapImages()` unbounded marker set (PERF-R4C15-B)

- **Citation:** `apps/web/src/lib/data.ts:1528-1545` (no LIMIT);
  `apps/web/src/components/map/map-client.tsx:40-46`
  (`Math.min(...lats)` spread; per-marker Leaflet DOM).
- **Severity/Confidence (preserved):** LOW impact / Medium confidence.
- **Reason for deferral:** at personal-gallery scale (hundreds of GPS
  photos) payload and marker cost are immaterial; any LIMIT would
  silently drop photos from the map (worse than slow); the real fix is
  marker clustering (supercluster / leaflet.markercluster), which is a
  product/dependency decision out of scope for a fix cycle.
- **Exit criterion:** map-visible GPS photo count approaches ~2,000,
  OR map-page payload/TTI complaints, OR a clustering dependency is
  approved — then implement clustering AND replace the spread-based
  bounds computation with a single-pass reduce in the same change.

## DEF-R4C15-B — `p/[id]/loading.tsx` lazy sessionStorage read vs SSR'd fallback (OBS-R4C15-A)

- **Citation:** `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:16`
  (`useState(readLightboxFlag)`).
- **Severity/Confidence (preserved):** LOW / Low (NEEDS VALIDATION).
- **Reason for deferral:** the divergent branch requires a hard load
  of `/p/[id]` while a stale `gallery_auto_lightbox=true` flag is
  still set (normally consumed by the viewer immediately after
  navigation); the worst case is React re-rendering the Suspense
  fallback client-side (brief shell swap), not incorrect content. No
  reproduction was achieved from code reading alone; "fixing" it by
  forcing the SSR branch would *remove* a deliberate UX nicety (black
  lightbox-context spinner) on every legitimate client navigation.
- **Exit criterion:** a reproduced hydration warning referencing this
  fallback, OR a user-visible white-flash report when opening photos
  from the lightbox/map flow — then gate the lightbox branch behind a
  post-mount `useEffect` state flip (render the neutral shell first
  paint, switch to lightbox shell after mount).

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `c49e4a7c..HEAD` touches only cycle-14 fix files
and plan notes; no deferral surface was modified. See
`.context/reviews/run4-cycle15/_aggregate.md` § Standing deferrals.

- **OBS-R4C14-A / DOC-R4C14-03 — PICKED UP this cycle** (plan-300):
  exit criterion ("next functional edit to touch-target-audit.test.ts")
  fires via plan-301 Task 3, which performs the prose refresh and the
  demanded re-evaluation (decision: keep bare size="sm"/"icon"
  patterns + exemptions as documented belt-and-braces). Closed by
  plan-301; no longer carried.
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map shape;
  device-fixture acquisition) — un-triggered; carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English) — no LR change; carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no host
  nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom
  passive preventDefault; Tailwind safelist) — carried (plan-288).
- Histogram mode-cycle aria-label — carried (plan-286).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards;
  data.ts:83; ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered; carried (plan-298).
