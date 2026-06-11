# Plan 308 — Run-4 Cycle 18 deferred ledger

**Source review:** `.context/reviews/run4-cycle18/_aggregate.md`
**Status:** RECORDED (deferred items only — nothing here is scheduled
for this cycle; severities preserved from the review, not downgraded)

Repo-rule basis for deferral (read before deferring, per the loop's
deferred-fix rules): CLAUDE.md permits deferral for non-security /
non-correctness / non-data-loss items when a concrete exit criterion
is recorded (established ledger convention plan-274 → plan-306).
DEF-R4C18-B is data-loss-ADJACENT; its deferral basis is quoted in
its own entry below. Deferred work remains bound by repo policy when
picked up (GPG-signed commits, conventional commits + gitmoji,
per-cycle gates, no suppressions).

## DEF-R4C18-A — feed route duplication (OBS-R4C18-A, LOW/High)

- **Citation:** `apps/web/src/app/feed.xml/route.ts:17-167` vs
  `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:14-150`
  (~90 duplicated lines: toIso, entry building, rights, feed-updated
  reduce, Last-Modified, 304 branch, headers).
- **Severity/Confidence (preserved):** LOW / High.
- **Problem:** lockstep-edit hazard, demonstrated twice (R25-M1
  patched both; COR-R4C18-01 exists because the topic copy's extra
  locale input had no reviewable seam).
- **Reason for deferral:** refactor with no live bug once plan-307
  Task 1 lands; both sources are pinned by
  feed-sized-derivative.test.ts; extraction risk exceeds current
  cost.
- **Exit criterion:** the next FUNCTIONAL change to either feed route
  (a third lockstep edit), or a third feed surface appears — then
  extract a shared `buildFeedResponse` helper.

## DEF-R4C18-B — entitlements cascade-delete with the image (OBS-R4C18-E, LOW-MED/High)

- **Citation:** `apps/web/src/db/schema.ts:280`
  (`image_id … references images.id onDelete: 'cascade'` NOT NULL).
- **Severity/Confidence (preserved):** LOW-MED / High.
- **Problem:** deleting a sold photo silently destroys its sale
  records (customerEmail, sessionId, amountTotalCents) and
  invalidates un-downloaded paid tokens — the /sales view loses the
  rows entirely.
- **Reason for deferral (data-loss-adjacent justification):** the
  paid-download flow is an explicitly pre-production scaffold — the
  webhook's own TODO (`US-P54-phase2`) defers the email pipeline, and
  token distribution is a manual opt-in
  (`LOG_PLAINTEXT_DOWNLOAD_TOKENS`) documented as a scaffold in
  README/route comments. The cascade is the DOCUMENTED schema design
  for that scaffold (document-specialist verified no doc contradicts
  it), and CLAUDE.md's runtime-topology section already classifies
  adjacent counters as "best-effort … not billing/audit-grade state".
  No production sale exists to lose. Changing the FK is a schema
  migration with restore/backfill implications — out of proportion
  while the surface is dormant. This is a deliberate-design RECORD +
  re-open trigger, not a silent drop.
- **Exit criterion:** paid downloads enter real use (email pipeline
  ships, or the first real production sale is recorded) — then
  decide `RESTRICT` vs soft-delete + archival before money-grade
  history can accumulate.

## Recorded decisions (not deferrals)

- **SEC-R4C18-04** — checkout (route.ts:112-133) and semantic
  (route.ts:192,205) post-DB refunds stay Pattern 2 DELIBERATELY:
  their limiters guard the Stripe API budget / embedding CPU, which
  the refunded branches never consume; image existence/tier are
  public on /p/{id}; no fetch-amplification analogue to OG. The
  rationale lands in code via plan-307 Task 3 (rate-limit.ts Pattern
  -4 header text) so the next route author sees it where they look.
  Severity preserved in the aggregate (LOW-MED/Medium).
- **OBS-R4C18-B** — checkout `parseInt('12abc')` laxness: harmless
  (single segment, parameterized PK, same money outcome); tighten
  opportunistically on the file's next functional edit.
- **OBS-R4C18-C** — `clampSemanticTopK(null)` → 1 instead of default
  20: reachable only by hand-crafted JSON; fewer results for the
  prober; not worth a contract change.
- **OBS-R4C18-D** — empty-feed `<updated>`/Last-Modified = request
  time so 304 never fires on photo-less feeds: self-heals on first
  photo; no fix scheduled.
- **NOTE-R4C18-D1** — theme-cycle button announces action not state
  (nav-client.tsx:150-160): FOLDED into the standing histogram
  mode-cycle aria-label deferral (plan-286) as the same class; fix
  both with one approach when that deferral re-opens.
- **TEST-R4C18-03** — no prose-lock test for the rate-limit header
  rewrite: per-bucket contracts are already source-locked; locking
  comments would be brittle without signal. Documented in
  `.context/reviews/run4-cycle18/test-engineer.md`.

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `c2aa4617..HEAD` touches only the c17 fix
surfaces, plan notes, and SW stamps — no deferral surface modified;
no exit criterion fires. See the aggregate § Standing deferrals.

- DEF-R4C17-A (OG photo HTTP loopback vs disk read — exit: observed
  OG latency, serve-route restructure, or second derivative-bytes
  consumer) — carried (plan-306).
- DEF-R4C17-B (caption stub codepoint truncation — exit: ONNX swap or
  non-EXIF input routed in) — carried (plan-306).
- DEF-R4C16-A (`db/seed.ts` deletion awaits explicit owner sign-off —
  destructive-action rule) — carried (plan-304).
- DEF-R4C16-B (manifest dark splash vs system theme) — carried
  (plan-304).
- DEF-R4C15-A (map marker clustering — exit ≳2k GPS photos / payload
  complaints / clustering dep approved) — carried (plan-302).
- DEF-R4C15-B (p/[id]/loading.tsx lazy sessionStorage vs SSR'd
  fallback) — carried (plan-302).
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map shape;
  device-fixture acquisition) — carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English — no LR change this cycle) — carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no host
  nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom
  passive preventDefault; Tailwind safelist) — carried (plan-288).
- Histogram mode-cycle aria-label — carried (plan-286), now also
  covering NOTE-R4C18-D1 (same class, same fix shape).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards;
  data.ts:83; ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered; carried (plan-298).
