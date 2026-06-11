# Plan 306 — Run-4 Cycle 17 deferred ledger

**Source review:** `.context/reviews/run4-cycle17/_aggregate.md`
**Status:** RECORDED (deferred items only — nothing here is scheduled
for this cycle; severities preserved from the review, not downgraded)

Repo-rule basis for deferral (read before deferring, per the loop's
deferred-fix rules): CLAUDE.md permits deferral for non-security /
non-correctness / non-data-loss items when a concrete exit criterion
is recorded (established ledger convention plan-274 → plan-304). The
security-adjacent observation inside DEF-R4C17-A is NOT deferred as a
security finding: its security component (Host-header trust on the
loopback fetch) is mitigated by the documented nginx + TRUST_PROXY
topology and by SEC-R4C17-01's charged-failure fix landing this cycle;
what is deferred is the PERF refactor. Deferred work remains bound by
repo policy when picked up (GPG-signed commits, conventional commits +
gitmoji, per-cycle gates, no suppressions).

## DEF-R4C17-A — OG photo HTTP loopback instead of direct disk read (PERF-R4C17-06, MED-LOW/Medium)

- **Citation:** `apps/web/src/lib/og-photo-fetch.ts:44-67`;
  `apps/web/src/app/api/og/photo/[id]/route.tsx:106-114`.
- **Severity/Confidence (preserved):** MED-LOW / Medium.
- **Problem:** the route buffers derivative bytes via
  `fetch(`${origin}/uploads/jpeg/…`)` (origin from `req.url`, i.e.
  the public host behind the proxy) although it embeds a data URL —
  the HTTP hop is self-inflicted per size attempt (≤ 8 attempts ×
  10 s timeout × 1 MB cap). A direct disk read from
  `public/uploads/jpeg/` would remove the socket/TLS hops, the
  timeout machinery, and the Host-header trust surface.
- **Reason for deferral:** bounded cost (caps above) on a CDN-cached
  (`s-maxage=86400`) endpoint in a single-host topology; the R24-M1
  fallback contract + its tests lock the current shape; a disk-read
  refactor must re-derive the serve route's safe-path containment
  (SAFE_SEGMENT / lstat / symlink rejection) — regression risk
  currently exceeds the measured cost (no observed OG latency
  complaint).
- **Exit criterion:** observed/complained OG generation latency in
  production, OR the next restructure of the uploads serve route, OR
  a second internal consumer of derivative bytes appears (a shared
  safe disk-read helper then pays for itself). Re-open as a scheduled
  task at that point.

## DEF-R4C17-B — caption stub truncation not codepoint-safe (OBS-R4C17-A, INFO)

- **Citation:** `apps/web/src/lib/caption-generator.ts:36`
  (`raw.slice(0, ALT_TEXT_MAX_CHARS)`).
- **Severity/Confidence (preserved):** INFO / High (convention nit).
- **Problem:** violates the repo's codepoint-safe truncation
  convention (C21-AGG-01 / `countCodePoints`); a surrogate split would
  emit U+FFFD in `alt_text_suggested`.
- **Reason for deferral:** input is `camera_model` from EXIF — ASCII
  in practice; the entire function is a documented stub slated for
  ONNX Florence-2 replacement; touching it now creates churn in code
  marked for replacement.
- **Exit criterion:** the ONNX swap lands (apply the convention in the
  real implementation), OR any non-EXIF input is routed into
  `generateCaptionStub`.

## Recorded decisions (not deferrals)

- **TEST-R4C17-02** — no jsdom render-lock for the two dashboard
  aria-labels: disproportionate per the c16 DES-R4C16-05 precedent;
  enforcement layer is eslint-jsx-a11y + review. Documented in
  `.context/reviews/run4-cycle17/test-engineer.md`.
- **TEST-R4C17-03** — no DB-coupled harness exists for
  `batchUpdateImageTags`; the Task-4 commit body must document the
  manually exercised path (rejected-name → warning) in lieu of a
  fixture.
- **OBS-R4C17-B** — analytics-client locale-agnostic `/p/`/`/g/`
  hrefs: intentional (documented in-file for `/g/`), middleware
  redirect covers locale; non-finding, recorded for trace continuity.
- **`formatBinarySize` GB/GiB labeling** (code angle): display-only
  nit on admin limit strings; not filed (would touch i18n for zero
  user value). Recorded so the consideration is auditable.

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `f8f97d96..HEAD` touches the c16 fix surfaces +
plan notes; `image-zoom.tsx` was modified by 217098aa but listener
passivity is untouched (verified in the c17 regression pass), so
DEF-R4C8-C's exit criterion does not fire. See
`.context/reviews/run4-cycle17/_aggregate.md` § Standing deferrals.

- DEF-R4C16-A (`db/seed.ts` deletion awaits explicit owner sign-off —
  destructive-action rule) — un-triggered; carried (plan-304).
- DEF-R4C16-B (manifest dark splash vs system theme) — un-triggered;
  carried (plan-304).
- DEF-R4C15-A (map marker clustering — exit ≳2k GPS photos / payload
  complaints / clustering dep approved) — un-triggered; carried
  (plan-302).
- DEF-R4C15-B (p/[id]/loading.tsx lazy sessionStorage vs SSR'd
  fallback — exit: reproduced hydration warning or white-flash
  report) — un-triggered; carried (plan-302).
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map shape;
  device-fixture acquisition) — un-triggered; carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English — no LR change this cycle) — carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no host
  nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom
  passive preventDefault; Tailwind safelist) — carried (plan-288).
- Histogram mode-cycle aria-label — carried (plan-286).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards;
  data.ts:83; ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered; carried (plan-298).
