# Plan 303 — Run-4 Cycle 16 fixes

**Source review:** `.context/reviews/run4-cycle16/_aggregate.md`
**Status:** IMPLEMENTED — all 6 tasks landed (progress log at bottom)
**Gates per fix:** eslint, typecheck, vitest, api-auth lint,
action-origin lint, public-route-rate-limit lint, production build,
playwright e2e — all green before the cycle closes; per-fix commits
GPG-signed, conventional + gitmoji, pushed after each task.

## Task 1 — COR-R4C16-01: complete the settle-before-close dialog pattern (MED-LOW/High, 6/6 angles)

**Problem:** `ui/alert-dialog.tsx` ships the raw Radix Action
(auto-closes on click). The c14 fix (DES-R4C14-B, `82e35324`)
established preventDefault → guard → await → close in
`tag-manager.tsx` only. Five siblings still auto-close with dead
in-flight UI:
- `components/image-manager.tsx:384` bulk delete (`isBulkDeleting`
  label dead)
- `components/image-manager.tsx:535` single delete (`deletingId`
  label dead)
- `components/admin-user-manager.tsx:184` delete user (also fix
  `handleDelete`'s dismiss-before-await at :68 — move dismissal to
  post-await)
- `admin/(protected)/categories/topic-manager.tsx:274` topic delete
  (dead Loader2; remove the synchronous `setDeleteSlug(null)` from
  onClick)
- `topic-manager.tsx:368` alias delete (same)
- `admin/(protected)/sales/sales-client.tsx:305` refund (dead
  `t.refunding`; `handleRefund`'s finally already closes — keep)

**Fix per call site (c14 reference shape):**
```tsx
<AlertDialogAction
  onClick={async (e) => {
    e.preventDefault();
    if (<no-target> || <inFlight>) return;
    await handleX(target);
    <dismiss>;            // only where the handler doesn't already
  }}
  disabled={<inFlight>}
>
```
plus `AlertDialogCancel disabled={<inFlight>}` and
`onOpenChange={(open) => { if (!open && !<inFlight>) <dismiss>; }}`.
Handlers must settle internally (all six catch already — verify per
site).

**Exemption:** `admin/(protected)/db/page.tsx:212` keeps its
deliberate auto-close (pure confirm gate; restore progress lives on
the page) — add the `@alert-dialog-auto-close-ok: <reason>` marker
comment.

**Lock (TEST-R4C16-01):** new
`apps/web/src/__tests__/alert-dialog-action-settle.test.ts` —
source-inspection fixture: normalize multi-line `<AlertDialogAction`
openings (reuse the touch-audit normalizer approach), require
`preventDefault(` inside the onClick body OR the marker comment
within the preceding lines. Prove failing 5/5 against pre-fix source
(git stash check), green after with exactly 1 marker.

**Acceptance:** all gates green; manual reasoning per dialog: ESC /
overlay / Cancel inert mid-flight; success AND error paths close or
keep open per c14 semantics; no double-submit window.

## Task 2 — COR-R4C16-02: GA4 CSP host set per Google's documented contract (MED-LOW/High, 4/6)

**Problem:** `lib/content-security-policy.ts:65-76` — connect-src
allows only `https://www.google-analytics.com`; no GA img-src. GA4
regional beacons (`region1.google-analytics.com`, EU data residency)
and img-beacon fallback are CSP-blocked → silent analytics
undercount.

**Fix:** in the `includeGoogleAnalytics` branch:
- script-src: `https://*.googletagmanager.com` (replaces the literal
  www host — documented contract)
- connect-src: `https://*.google-analytics.com
  https://*.analytics.google.com https://*.googletagmanager.com`
- img-src: append `https://*.google-analytics.com
  https://*.googletagmanager.com` (only when GA is configured —
  keep the base img-src untouched otherwise)
Scope: analytics tier ONLY — no doubleclick/google.<TLD> advertising
hosts (critic).

**Lock (TEST-R4C16-02):** update
`__tests__/content-security-policy.test.ts` expectations; add
negative assertion (no `doubleclick`); keep the GA-absent case
asserting none of the GA hosts appear.

**Acceptance:** gates green; CSP without GA id unchanged
byte-for-byte (test-locked).

## Task 3 — COR-R4C16-03: make IMAGE_BASE_URL reach client bundles (MED/High latent, 6/6)

**Problem:** `lib/constants.ts:7` non-NEXT_PUBLIC env read; compiled
client chunks do `env.IMAGE_BASE_URL||""` → always '' in browser.
Nine client components compute image URLs through `lib/image-url.ts`;
under the documented CDN contract all interactive fetches bypass the
CDN and SSR'd client components hydration-mismatch.

**Fix (runtime injection):**
1. `app/[locale]/layout.tsx`: stamp
   `data-image-base={IMAGE_BASE_URL || undefined}` on the rendered
   `<html>` element.
2. `lib/image-url.ts`: add lazy resolver —
   ```ts
   function resolveImageBase(): string {
     if (typeof document !== 'undefined') {
       return document.documentElement?.dataset?.imageBase ?? '';
     }
     return IMAGE_BASE_URL;
   }
   ```
   `imageUrl()` uses `resolveImageBase()` instead of the module
   constant. NO module-scope document access (SSR safety, critic).
3. `lib/constants.ts`: update the comment to describe server-env +
   html-dataset dual resolution (DOC-R4C16-01); note BASE_URL is
   server-scope-only today (architect).

**Hydration safety:** server SSR pass and the stamped attribute read
the same env → first client render equal. Unset env: both sides ''
→ zero behavior change (current production).

**Lock (TEST-R4C16-03):** unit tests for the resolver's 3 branches
(no document → env; dataset present incl. trailing slash → dataset;
dataset absent → ''); source fixture asserting the locale layout
stamps `data-image-base` (so a layout refactor can't sever the
injection silently).

**Commit body:** cite DOC-R4C16-01 (corrects `660e0911`'s CDN claim
lineage).

**Acceptance:** gates green (jsdom component tests unaffected:
dataset absent → '' matches current expectations); no hydration
warnings in e2e.

## Task 4 — DES-R4C16-04: 44 px upload topic select + audit `<select>` extension (LOW/High, 3/6)

**Problem:** `components/upload-dropzone.tsx:368` native `<select>`
at `h-10` (40 px) — policy floor is 44 px; audit FORBIDDEN domain
(Button/button/Badge-asChild) cannot see native selects.

**Fix:** `h-10` → `h-11` on the select. Extend
`touch-target-audit.test.ts`: normalizer tag set += `select`;
FORBIDDEN += sub-44 height literals (`h-8`/`h-9`/`h-10` and
`min-h-[0-43px]` arbitrary values) on `<select` in string-literal and
cn() forms with the established ≥44 override lookahead. Fixtures:
violation + compliant shapes (incl. multi-line). Prove the extension
catches exactly the 1 pre-fix violation. CLAUDE.md pattern-coverage
line += native `<select>` (document angle: doc and gate in one diff).

**Acceptance:** audit green with zero new exemptions; gates green.

## Task 5 — DES-R4C16-05: live-region semantics on dynamic notices (LOW/High, 2/6)

**Fix:**
- `settings-client.tsx:185` backfill-required amber banner div →
  `role="status"`.
- `bulk-edit-dialog.tsx:325` validation error `<p>` →
  `role="alert"`.
Precedent C4-RPF-09 (sales errorLoad). No test infra exists for
static a11y attrs of this shape (jsdom render-assert is
disproportionate for two attributes) — verified by eslint-jsx-a11y +
review; note in commit body.

**Acceptance:** gates green.

## Task 6 — UX-R4C16-06: anchor double-tap/click zoom at the pointer (MED-LOW/Medium, 4/6)

**Problem:** `image-zoom.tsx:174-178` (click), `:197-209`
(double-tap) zoom to center; wheel path (`:98-113`) already anchors
at the cursor. Photographer mobile flow ("double-tap the eye")
broken.

**Fix:**
1. `lib/image-zoom-math.ts`: add pure
   `anchoredZoomPosition(currentLevel, newLevel, anchorXPct,
   anchorYPct, position)` returning the clamped pan that keeps the
   anchor point fixed (extract the wheel path's inline arithmetic).
2. `image-zoom.tsx`: wheel path uses the helper (no behavior
   change); click handler anchors at `e.clientX/Y`; double-tap
   anchors at `e.changedTouches[0].clientX/Y`. Zoom-OUT (reset)
   behavior unchanged. Pinch flow untouched (DEF-R4C8-C passivity
   deferral untouched).

**Lock (TEST-R4C16-05):** extend the existing image-zoom-math test
file: anchored zoom-in off-center, zoom from existing pan, clamp
saturation at edges, identity when ratio = 1.

**Acceptance:** unit tests green; wheel behavior provably identical
(helper extraction covered by the same tests); gates green.

## Deferred this cycle

See `plan/plan-304-run4-cycle16-deferred.md` (OBS-R4C16-A db/seed.ts
dead script — deletion needs owner sign-off; OBS-R4C16-B manifest
dark splash; plus the standing-deferral re-audit — nothing fires).

## Progress log

- Task 1 DONE — `7144479c` fix(admin): settle-before-close on all six
  confirm dialogs. image-manager's two uncontrolled dialogs converted
  to controlled state (the settle pattern needs an explicit close);
  admin-user-manager's dismiss-before-await moved to post-settle;
  topic-manager's synchronous dismisses removed from onClick;
  sales-client refund holds the dialog with "Refunding…".
  db/page marker added. Lock proven failing 7/7 pre-fix
  (6 to fix + db/page pre-marker), green post-fix with exactly
  1 documented marker; tag-manager canary included.
- Task 2 DONE — `61d85a05` fix(csp): GA4 wildcard host set per
  Google's documented analytics-tier contract; negative
  advertising-host assertions; GA-absent CSP locked unchanged.
- Task 3 DONE — `61218056` fix(images): IMAGE_BASE_URL runtime
  injection (html data-image-base + lazy resolver in image-url.ts);
  3-branch resolver tests + layout-stamp wiring lock; constants.ts
  scope comments (DOC-R4C16-01 lineage cited in commit body).
- Task 4 DONE — `e0f7f684` fix(a11y): 44px upload topic select +
  native-<select> audit patterns/normalizer/fixtures. Bonus
  hardening surfaced during proof: the stale
  'upload-dropzone.tsx': 1 KNOWN_VIOLATIONS budget (for a long-fixed
  Clear-all shape) was silently absorbing the new select violation
  under the <=-budget semantics — re-tightened to 0, then proven
  failing (found 1 / allowed 0 at line 366) and green post-fix.
  CLAUDE.md pattern coverage updated in the same diff.
- Task 5 DONE — `233c38b2` fix(a11y): role="status" on the settings
  backfill banner; role="alert" on the bulk-edit validation error.
- Task 6 DONE — `217098aa` feat(viewer): pointer-anchored double-tap/
  click zoom via anchorPctFromClientPoint + anchoredZoomPosition
  extracted VERBATIM from the wheel path (wheel + pinch pure
  refactors, behavior locked by an extraction-equivalence test);
  keyboard toggle keeps center; 32 zoom tests green. DEF-R4C8-C
  passivity deferral untouched.
