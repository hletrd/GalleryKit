# Aggregate review — Run-4 Cycle 16

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent;
nested Agent/Task spawning is unavailable in this context (same
documented constraint as run2/run3/run4-c1..c15). Each angle was
executed as a distinct full-inventory in-context pass; no angle
sampled. Inventory: line-level regression review of the four
cycle-15 fix commits (`cd873449`, `660e0911`, `5d0983d7`,
`cfcaa866`); rotation to the zero/low-run-4-coverage surfaces by a
fresh mention-count coverage map over run4-c1..c15 review texts —
the **admin-client cluster** (password/sales/settings clients,
bulk-edit-dialog, upload-dropzone, admin-header, image-zoom), the
**payments/licensing cluster** (stripe, license-tiers,
download-tokens, base56), the **platform-lib cluster** (CSP builder,
csp-nonce, locale-path, revalidation, action-guards,
feed-conditional, constants, utils, caption-generator, avif-support,
image-url), and the **PWA/app-chrome cluster** (manifest, icon
routes, SW registration, theme/i18n providers, lazy-focus-trap,
photo-viewer-loading, db/seed); cross-file traces (AlertDialogAction
× 6 consumers; GA config source × CSP builder × layout; IMAGE_BASE_URL
× 9 client consumers × compiled chunks); ui-primitives suppression
sweep; sub-44 literal sweep.

## Context

C15 closed the theme/thumbnail/touch-target divergences on the app
shell and map. C16's rotation landed on the admin clients and the
platform libs — and found the loop's recurring failure mode twice
more: a canonical correct instance exists and siblings silently
diverge (c14's settle-before-close dialog pattern stopped at
tag-manager — five siblings broken; the wheel path's anchored-zoom
math never reached the double-tap path), plus one
documented-contract gap proven at compiled-bundle level
(IMAGE_BASE_URL never reaches client bundles).

## Cross-angle agreement

- **COR-R4C16-01** — code/debugger/tracer (primary: six call sites
  traced through the Radix Action close semantics), designer
  (destructive-action feedback contract; refund + bulk delete the
  worst offenders), critic (fix-shape: mechanical c14-pattern
  alignment, NOT a new wrapper primitive; db/page exempt via marker),
  verifier (CONFIRMED — all six call sites read; grep proves
  tag-manager is the only preventDefault user), test-engineer (class
  lock: source-inspection fixture, proven failing 5/5 pre-fix),
  architect (no owned async-confirm idiom → lock makes the existing
  one self-enforcing). **6/6 angles.**
- **COR-R4C16-03** — code (primary; bundle-level proof), perf (CDN
  bypass lands on the hottest interactive surfaces), critic (dataset
  injection over NEXT_PUBLIC rename — runtime-env Docker flow),
  architect (config-scope boundary note on constants.ts), verifier
  (CONFIRMED via compiled chunk `env.IMAGE_BASE_URL||""`),
  document-specialist (falsifies `660e0911`'s CDN claim +
  constants.ts comment), test-engineer (3-branch resolver tests +
  layout-stamp source fixture). **6/6 angles.**
- **COR-R4C16-02** — security (primary; verified against Google's
  CSP guide 2026-06-11), critic (scope to analytics tier; no
  advertising hosts), test (existing CSP test encodes the bug —
  update + negative assertion), document (vendor-doc mismatch).
  **4/6 angles.**
- **DES-R4C16-04** — designer (primary), test (audit blind to native
  `<select>` — next escape hatch after c15's Badge/arbitrary-value
  extension), code concurs. **3/6.**
- **DES-R4C16-05** — designer (primary), security/verifier
  (CONFIRMED with precedent C4-RPF-09). **2/6.**
- **UX-R4C16-06** — code (asymmetry vs wheel path), designer
  (photographer mobile flow), test (extract math to make it
  testable), critic (extract, don't duplicate inline a third time).
  **4/6.**

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C16-01 | **MED-LOW/High (CONFIRMED)** | Five `AlertDialogAction` confirm dialogs auto-close while their async action is in flight — `image-manager.tsx:384,535` (bulk/single delete, dead `isBulkDeleting`/`deletingId` labels), `admin-user-manager.tsx:184` (+ dismiss-before-await at :68), `topic-manager.tsx:274,368` (dead Loader2 spinners), `sales-client.tsx:305` (dead `t.refunding` on an irreversible multi-second Stripe call). The c14 pattern (`tag-manager.tsx:148-160`, DES-R4C14-B) never rolled out. Fix all six call sites (preventDefault → guard → await → close; Cancel/onOpenChange inert mid-flight); `db/page.tsx:70` exempt via `@alert-dialog-auto-close-ok` marker (deliberate confirm-gate + page-level progress); lock with `alert-dialog-action-settle.test.ts` proven failing 5/5 pre-fix. | 6/6 |
| COR-R4C16-02 | **MED-LOW/High (CONFIRMED)** | Production CSP blocks GA4 regional collection: `content-security-policy.ts:73-76` allows only `www.google-analytics.com` in connect-src (no GA img-src) — EU visitors' `region1.google-analytics.com/g/collect` beacons are CSP-blocked → silent analytics undercount. Fix to Google's documented analytics-tier set (script-src `https://*.googletagmanager.com`; img-src + connect-src `https://*.google-analytics.com https://*.googletagmanager.com` + connect `https://*.analytics.google.com`); update CSP tests + negative advertising-host assertion. | 4/6 |
| COR-R4C16-03 | **MED/High (CONFIRMED, latent)** | `constants.ts:7` `IMAGE_BASE_URL` is non-NEXT_PUBLIC but consumed by `image-url.ts` in nine client components — compiled chunks do runtime `env.IMAGE_BASE_URL||""` against the browser shim → always `''` client-side. Under the documented CDN-fronted contract: all interactive image fetches bypass the CDN; SSR'd client components hydration-mismatch. Falsifies `660e0911`'s CDN rationale. Fix: locale layout stamps `data-image-base` on `<html>`; `image-url.ts` resolves lazily (server env / browser dataset); 3-branch unit tests + layout-stamp source fixture; update `constants.ts` comment (DOC-R4C16-01). | 6/6 |
| DES-R4C16-04 | LOW/High (CONFIRMED) | `upload-dropzone.tsx:368` native topic `<select>` at `h-10` (40 px) on the admin upload surface — below the blocking 44 px policy, in a shape invisible to the audit. Fix: `h-11`; extend audit FORBIDDEN + normalizer to native `<select>` sub-44 literals with failing-then-passing fixtures. | 3/6 |
| DES-R4C16-05 | LOW/High (CONFIRMED) | Dynamic warning/error surfaces with no live-region semantics: `settings-client.tsx:184` backfill-required amber banner (→ `role="status"`), `bulk-edit-dialog.tsx:324` validation error (→ `role="alert"`). Precedent C4-RPF-09. | 2/6 |
| UX-R4C16-06 | MED-LOW/Medium (CONFIRMED behavior, judgment call) | `image-zoom.tsx:174-178,197-209` double-tap (touch) and click (desktop) zoom to CENTER while the wheel path anchors at the cursor — photographer "double-tap the detail" flow broken on mobile. Fix: extract `anchoredZoomPosition()` into `image-zoom-math.ts` (unit-tested), use from wheel + double-tap + click paths. | 4/6 |
| TEST-R4C16-01..05 | gap/High | Class locks for the five fixes above — each folds into its fix commit (settle lock; CSP test update; resolver tests + layout fixture; audit `<select>` extension; zoom-math extraction tests). | test |
| DOC-R4C16-01 | INFO/High | `660e0911` commit-body CDN claim + `constants.ts:6` comment overclaim — resolved BY COR-R4C16-03's commit (cite lineage). | document |
| OBS-R4C16-A | INFO (record) | `db/seed.ts` dead script: `db:seed` maps to `scripts/seed-admin.ts`; stale personal-default topics; open pool would hang. Deletion = destructive act → record in deferred ledger for owner sign-off. | code, document |
| OBS-R4C16-B | INFO (record) | `manifest.ts` pins dark `background_color`/`theme_color` while default theme is `system` — installed-PWA splash dark for light-theme users; self-consistent brand choice. | document, designer |

## Regression review of cycle-15 commits — SOUND (one claim caveat)

`cd873449`, `5d0983d7`, `cfcaa866` verified line-level, no follow-on.
`660e0911` — implementation correct and the sized-thumbnail perf fix
real; the commit body's CDN claim cannot hold until COR-R4C16-03
lands (the idiom is still right — the surface becomes CDN-correct
the moment the base resolves client-side). Captured as DOC-R4C16-01.

## Clean-pass surfaces this cycle

Full lists in the per-angle files. Highlights: payments/licensing
cluster fully clean (token shape/timing-safe verify, rejection
sampling, lazy Stripe singleton, closed tier allowlist); GA
config-source consistency verified NON-finding (proxy passes
siteConfig into the CSP builder — the env default is test-only);
platform libs clean (locale-path, revalidation, action-guards,
feed-conditional, csp-nonce, avif-support); PWA chrome clean;
`bulk-edit-dialog` is the one ALREADY-correct settle-before-close
dialog; settings-client save/baseline flow correct; upload-dropzone
object-URL lifecycle + latest-wins refs + partial-failure retention
correct; bare SelectTriggers are 44 px through the primitive's
`min-h-11` floor; ui-primitives suppression sweep clean;
`image-manager` checkbox labels match the documented admin
keyboard-primary exemption shape.

## Standing deferrals re-audit (exit criteria)

Diff since the c15 review commit (`8c39bac3..HEAD`) touches only
plan-301 progress notes — no deferral surface modified, no exit
criterion fires this cycle:
- DEF-R4C15-A (map clustering ≳2k markers), DEF-R4C15-B (loading.tsx
  sessionStorage) — un-triggered; carried.
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map device
  fixture) — un-triggered; carried.
- DEF-R4C11-A; DEF-R4C10-A/B; DEF-R4C1-01/DEF-R4C2-01/DEF-R4C3-01
  (LR PAT breadth/scopes/English — no LR change); OPS-R4C6-01 (host
  nginx `/uploads/`); DEF-R4C8-A/B/C/D (incl. ImageZoom passive
  preventDefault — NOTE: UX-R4C16-06 touches image-zoom.tsx but does
  not change listener passivity, so DEF-R4C8-C stays carried);
  histogram mode-cycle aria-label; OBS-R4C12-B/C/D/E;
  DOC-R4C13-01/02 — all un-triggered; carried.

## Gate baseline (clean tree)

Cycle-15 close: vitest 185 files / 1770 tests green; all 8 gates
green; deploy verified live (SW `cfcaa866-p7`). All 8 gates re-run
during PROMPT 3 after this cycle's fixes land.

## HARD-SCOPE check

No finding proposes edit / culling / scoring / preset features. All
scheduled fixes tighten existing surfaces: feedback fidelity
(dialogs), delivery correctness (CDN base), analytics integrity
(CSP), accessibility (target size, live regions), viewing UX (zoom
anchor).

## AGENT FAILURES

None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool
is unavailable in this environment, per the documented run-wide
constraint).
