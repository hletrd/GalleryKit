# Run-4 Cycle 16 — code-reviewer + debugger + tracer angle

Single-subagent in-context pass (Agent tool unavailable in this
environment — same documented constraint as run2/run3/run4-c1..c15).
No sampling: every file in the rotation inventory below was read in
full; the cycle-15 fix commits were re-read at diff level.

## Inventory

**Regression review (cycle-15 fix commits):** `cd873449`
(global-error theme), `660e0911` (map popup thumbs), `5d0983d7`
(tag-filter + audit extension), `cfcaa866` (admin-nav/footer/error
region), `5a94ccdb` (SW version stamp).

**Rotation set (run-4 zero/low-coverage files via mention-count map
over run4-c1..c15 review texts):**
- Admin clients: `password-client.tsx`, `sales-client.tsx`,
  `settings-client.tsx`, `bulk-edit-dialog.tsx`, `upload-dropzone.tsx`,
  `admin-header.tsx`, `image-zoom.tsx`
- Payments/licensing: `lib/stripe.ts`, `lib/license-tiers.ts`,
  `lib/download-tokens.ts`, `lib/base56.ts`
- Platform libs: `lib/content-security-policy.ts`, `lib/csp-nonce.ts`,
  `lib/locale-path.ts`, `lib/revalidation.ts`, `lib/action-guards.ts`,
  `lib/feed-conditional.ts`, `lib/constants.ts`, `lib/utils.ts`,
  `lib/caption-generator.ts`, `lib/avif-support.ts`, `lib/image-url.ts`
- PWA/app chrome: `app/manifest.ts`, `app/icon.tsx`,
  `app/apple-icon.tsx`, `register-service-worker.tsx`,
  `theme-provider.tsx`, `i18n-provider.tsx`, `lazy-focus-trap.tsx`,
  `photo-viewer-loading.tsx`, `db/seed.ts`
- Cross-file consumers traced: `ui/alert-dialog.tsx` + all six
  `AlertDialogAction` consumers (`image-manager.tsx`,
  `admin-user-manager.tsx`, `topic-manager.tsx`, `tag-manager.tsx`,
  `sales-client.tsx`, `admin/db/page.tsx`); `app/actions/images.ts`
  bulk-update region; `app/[locale]/layout.tsx` GA region;
  `proxy.ts` CSP wiring; `next.config.ts`; compiled client chunks
  under `.next/static/chunks/` (bundle-level verification).

## Regression review of cycle-15 commits — SOUND

- `cd873449` — `resolveErrorShellThemeClass` is a pure closed-contract
  helper ('oled' | 'dark' | null); oled wins the defensive
  both-classes case; applied on the rendered `<html>`. Verified the
  helper + wiring + tests. No follow-on.
- `660e0911` — MarkerThumb mirrors the R23-M1 idiom correctly;
  one-shot onError ref guard correct; imageSizes plumbed without a
  DEFAULT_IMAGE_SIZES shortcut. The *perf* claim holds. The *CDN*
  claim in the commit body does NOT hold today (see COR-R4C16-03
  below) — `imageUrl()` resolves the base from a non-NEXT_PUBLIC env
  var that is empty in client bundles. The fix idiom is still right:
  the surface becomes CDN-correct the moment COR-R4C16-03 lands.
- `5d0983d7` — chips at min-h-11; normalizer covers Badge; six
  arbitrary-value FORBIDDEN patterns; fixtures verified present.
- `cfcaa866` — admin-nav min-h-11, footer 44 px links, region label
  dedupe all verified at diff level. No follow-on.

## Findings

### COR-R4C16-01 — five of six AlertDialogAction confirm dialogs auto-close while their async action is in flight; their in-flight UI is dead code (MED-LOW / High, CONFIRMED)

`components/ui/alert-dialog.tsx:121-131` renders the raw Radix
`AlertDialogPrimitive.Action`, which closes the dialog on click
regardless of async work. Cycle 14 (DES-R4C14-B, commit `82e35324`)
established the repo pattern in `tag-manager.tsx:148-160`:
`e.preventDefault()` in onClick → guard re-entry → `await` the
handler → close explicitly; Cancel + onOpenChange inert mid-flight.
That rollout stopped at tags. The same defect class survives in:

1. `components/image-manager.tsx:384` — bulk delete:
   `<AlertDialogAction onClick={handleBulkDelete} disabled={isBulkDeleting}>{isBulkDeleting ? deleting : delete}` —
   the dialog is gone before `isBulkDeleting` flips; label + disabled
   are unreachable. Bulk delete of up to 100 images can take seconds;
   the admin stares at the table with no feedback until the toast.
2. `components/image-manager.tsx:535` — single delete: same shape via
   `deletingId === image.id`.
3. `components/admin-user-manager.tsx:184` — delete admin user:
   `disabled={isDeleting}` dead; worse, `handleDelete` (line 67-68)
   dismisses the target BEFORE starting the delete, so even the c14
   fix shape needs the dismiss moved to post-await.
4. `app/[locale]/admin/(protected)/categories/topic-manager.tsx:274` —
   topic delete: `Loader2` spinner + "Deleting…" ternary dead; the
   onClick even dismisses synchronously (`setDeleteSlug(null)`).
5. `topic-manager.tsx:368` — alias delete: same shape.
6. `sales-client.tsx:305-311` — Stripe refund:
   `{refundingId !== null ? t.refunding : t.refundConfirmAction}` is
   unreachable in the normal flow (dialog auto-closes at confirm
   click; the multi-second Stripe network call runs with zero
   in-dialog feedback). Cross-row edge: while refund A is in flight,
   opening row B's confirm shows "Refunding…" disabled — A's state
   bleeding into B's dialog.

`admin/db/page.tsx:70-71` (`confirmRestore`) is the one deliberate
auto-close: it dismisses as a pure confirm gate and the restore runs
under `startTransition` with its own page-level progress UI — exclude
with a documented marker, do not "fix".

**Failure scenario:** admin confirms a 100-image bulk delete on a slow
connection; dialog vanishes; table looks idle; admin re-selects and
re-confirms → double-submit window (the second submit is only blocked
if the click lands while `isBulkDeleting` — which the UI no longer
communicates).

**Fix:** apply the c14 pattern to all six call sites (preventDefault →
re-entry guard → await → close; Cancel `disabled` + onOpenChange
guarded mid-flight). Add a source-inspection lock
(`__tests__/alert-dialog-action-settle.test.ts`) that scans every
`<AlertDialogAction` usage and requires `preventDefault()` in its
onClick body or an explicit `@alert-dialog-auto-close-ok: <reason>`
marker (db/page.tsx gets the marker).

### COR-R4C16-03 — `IMAGE_BASE_URL` never reaches client bundles: every client-rendered image URL silently bypasses the CDN; SSR'd client components would hydration-mismatch under a CDN deployment (MED / High, CONFIRMED at bundle level)

`lib/constants.ts:7`:
```ts
export const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || '';
```
`IMAGE_BASE_URL` is not `NEXT_PUBLIC_`-prefixed, and `lib/image-url.ts`
(which consumes it in `imageUrl()` / `sizedImageUrl()` /
`sizedImageSrcSet()`) is imported by NINE client components:
`photo-viewer.tsx`, `lightbox.tsx`, `home-client.tsx`, `search.tsx`,
`map/map-client.tsx`, `on-this-day-widget.tsx`, `image-manager.tsx`,
`lightbox-color-pip.tsx`, `info-bottom-sheet.tsx`.

Compiled-artifact proof: `.next/static/chunks/0z_8k18mys.tf.js`
contains `t.default.env.IMAGE_BASE_URL||""` — a RUNTIME lookup against
the browser's `process.env` shim, which only carries `NEXT_PUBLIC_*`
values. In the browser the base is always `''`.

**Consequences when an operator sets `IMAGE_BASE_URL` (the documented
CDN-fronted deployment contract in `lib/constants.ts` and the CSP/
remotePatterns support in `next.config.ts` + `proxy.ts`):**
- All client-side URL computation (lightbox prev/next swaps, search
  results, map popups, on-this-day thumbs, viewer preloads) hits the
  app origin instead of the CDN — the CDN feature silently degrades to
  origin serving on exactly the high-traffic interactive surfaces.
- SSR'd client components (photo-viewer et al.) emit CDN URLs in
  server HTML, then recompute `''`-based URLs at hydration — a React
  19 hydration mismatch that re-renders the subtree client-side and
  re-fetches the images from origin.

Today the shipped single-host topology leaves `IMAGE_BASE_URL` unset,
so the bug is fully latent — but it falsifies the CDN rationale used
as recently as cycle-15's `660e0911`.

**Fix (runtime injection, no build-time env contract change):** locale
layout stamps the value on the rendered `<html>` as
`data-image-base`; `image-url.ts` resolves the base lazily — server:
env constant; browser: `document.documentElement.dataset.imageBase ?? ''`.
Hydration-safe (server writes the attribute from the same env the SSR
pass used). Zero behavior change when unset. Lock with unit tests
(dataset present/absent/trailing-slash) + a source fixture asserting
layout stamps the attribute.

### UX-R4C16-06 — double-tap zoom anchors to image CENTER, not the tap point (MED-LOW / Medium)

`components/image-zoom.tsx:197-209` (touch double-tap) and 174-178
(desktop click-to-zoom): on zoom-in the transform is
`applyTransform(targetLevel, 0, 0, true)` with `positionRef = {0,0}` —
the viewport zooms into the center regardless of where the user
tapped. The wheel path (lines 98-113) already implements the correct
cursor-anchored math (anchor% → pan adjusted by scale ratio →
`clampPan`). Every mainstream photo viewer (iOS Photos, Google
Photos, Lightroom mobile) anchors double-tap zoom at the tap point;
for a photographer-intent delivery product, "double-tap the eye to
check focus" landing on the image center is a real mobile-UX miss.

**Fix:** extract the anchored-zoom-target math into
`lib/image-zoom-math.ts` (`anchoredZoomPosition(...)`, unit-tested),
reuse it from the wheel path AND the double-tap/click toggle paths
with the tap coordinates. Pinch flow untouched.

## Observations (record, do not schedule)

- **OBS-R4C16-A (INFO):** `db/seed.ts` is dead code — `npm run
  db:seed` maps to `scripts/seed-admin.ts` (package.json:18); nothing
  references `db/seed.ts`. It also seeds personal-default topics
  ('idol', 'plane') and never closes the pool (would hang if ever
  run). Deletion is a destructive act per repo safety rules — record
  for owner sign-off.
- `sales-client.tsx:82` `computeStatus` re-evaluates `new Date()` per
  render — fine at table scale; not a finding.
- `upload-dropzone.tsx` object-URL lifecycle (incremental create/
  revoke + unmount sweep), latest-wins refs (topic/tags), and the
  partial-failure retention logic all verified correct.
- `image-zoom.tsx` `onTouchMove` `preventDefault()` via React
  synthetic handlers is the standing DEF-R4C8-C deferral
  (passive-listener caveat) — untouched, still carried.

## Clean passes (full-file reads, no findings)

`stripe.ts` (lazy singleton correct), `license-tiers.ts` (Referer →
accept-language locale layering correct), `download-tokens.ts`
(shape checks + timingSafeEqual + malformed-stored-hash warn),
`base56.ts` (rejection sampling at 224 = 4×56 correct; pool refill
sound), `caption-generator.ts` (stub honest, fire-and-forget
contract documented), `locale-path.ts`, `revalidation.ts`,
`action-guards.ts`, `feed-conditional.ts` (second-precision compare
correct), `csp-nonce.ts`, `avif-support.ts` (Promise singleton),
`manifest.ts` / `icon.tsx` / `apple-icon.tsx`,
`register-service-worker.tsx`, `theme-provider.tsx`,
`i18n-provider.tsx`, `lazy-focus-trap.tsx`,
`photo-viewer-loading.tsx` (role=status), `password-client.tsx`,
`admin-header.tsx` (size="sm" logout is 44 px through the lifted
variant CSS; audit bookkeeping consistent), `bulk-edit-dialog.tsx`
(the one dialog that already implements settle-before-close
correctly; ESC guarded by isSubmitting), `constants.ts` /
`utils.ts` (modulo COR-R4C16-03 which is a bundling-boundary issue,
not a logic bug), `db/seed.ts` (dead — see OBS-R4C16-A),
bulk-update server action tag add/remove ordering (remove wins on
overlap — deterministic, safe direction).
