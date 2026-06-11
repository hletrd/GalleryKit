# Run-4 Cycle 16 — document-specialist angle

Single-subagent in-context pass. Authoritative sources consulted:
Google Tag Platform CSP guide (fetched 2026-06-11), Radix UI
AlertDialog.Action close semantics (verified against the vendored
primitive + c14 commit narrative), Next.js env-var client-bundle
rules (verified empirically against the compiled chunks — stronger
than doc citation), repo CLAUDE.md, plan ledgers plan-274..302.

## Doc/code mismatches

### DOC-R4C16-01 — cycle-15 commit `660e0911` claims CDN correctness that the client bundle cannot deliver (INFO / High — resolved BY COR-R4C16-03)

The commit body states: "Routing through imageUrl()/sizedImageUrl()
also honors IMAGE_BASE_URL on CDN-fronted deployments; the previous
raw `/uploads/jpeg/${…}` interpolation was the only image surface in
src/ bypassing it." The second half is true; the first half is false
in client bundles today (`MapClient` is a browser-only Leaflet
component — `imageUrl()` resolves base `''` there; bundle-level
evidence in the code angle). No commit can be amended; the fix commit
for COR-R4C16-03 must cite this lineage so the history is
self-correcting. `lib/constants.ts:6` ("Override with IMAGE_BASE_URL
env var for CDN-fronted deployments") carries the same overclaim —
the fix should update that comment to describe the server-env +
html-dataset dual resolution.

### DOC-R4C16-02 — Google's GA4 CSP requirements vs ours (folds into COR-R4C16-02)

Documented requirement (developers.google.com/tag-platform/security/
guides/csp, analytics tier): script-src `https://*.googletagmanager.com`;
img-src `https://*.google-analytics.com https://*.googletagmanager.com`;
connect-src `https://*.google-analytics.com
https://*.analytics.google.com https://*.googletagmanager.com`.
Ours: script-src literal `www.googletagmanager.com` (sufficient for
the loader today but not the documented contract), connect-src
literal `www.google-analytics.com` only, img-src none. The fix
aligns the builder with the vendor-documented set; the test file is
the in-repo documentation of that contract.

### Verified-consistent (no action)

- CLAUDE.md touch-target section vs `touch-target-audit.test.ts`
  post-c15 prose — consistent (c15 refreshed both). The DES-R4C16-04
  audit extension must add ONE line for the `<select>` pattern set in
  the same commit (same rule applied in c15 — keep doc and gate in
  one diff).
- CLAUDE.md "Image Upload Flow" / queue / advisory-lock sections vs
  current `image-queue.ts` behavior — spot-checked, consistent.
- `tag-manager.tsx` DES-R4C14-B comment block accurately describes
  the implemented semantics (re-verified line-level).
- plan/README.md index vs plan/ directory state — consistent at
  cycle-15 close; this cycle appends plan-303/304.
- `docs`-level deploy/runbook sections (backfill sidecar, disk
  hygiene) — untouched surfaces this cycle, no drift signal.

### Marginal (record only)

- OBS-R4C16-B (INFO): `app/manifest.ts` pins
  `background_color`/`theme_color` to `#09090b` (dark) while the app
  defaults to `system` theme and the layout serves a light/dark
  `themeColor` media array — an installed PWA shows a dark splash to
  light-theme users. Self-consistent dark-first brand choice;
  documenting intent in a comment would suffice if ever touched.
- OBS-R4C16-A (INFO): `db/seed.ts` dead script — also contradicts
  CLAUDE.md's description of `db:seed` ("Seed admin user"), which
  actually maps to `scripts/seed-admin.ts`. CLAUDE.md is RIGHT about
  the npm script; the stray file is the inconsistency. Record for
  deletion sign-off.
