# Plan 278 — Run-4 Cycle 3 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle3/_aggregate.md`
Every finding from the run-4 cycle-3 reviews is either scheduled in
`plan/plan-277-run4-cycle3-fixes.md` or recorded here. Severity/confidence
preserved from the original review (no downgrades). Deferred work remains bound
by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no
`--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## Deferred items

### DEF-R4C3-01 — LR upload route error strings are hardcoded English
- **Original ID / severity / confidence:** UX-R4C3-OBS-A — LOW / Low (designer
  observation).
- **Citation:** `apps/web/src/app/api/admin/lr/upload/route.ts:74-264` — every
  `NextResponse.json({ error: '…' })` literal is English (e.g. line 91
  `'Invalid filename'`, line 259 `'RAW files are not supported. Export to
  JPEG, TIFF, or AVIF first.'`).
- **Category check:** not security, not correctness, not data-loss — purely a
  localization-reach observation on a machine-client API. Deferral permitted; no
  repo rule forbids deferring i18n polish on non-browser surfaces (CLAUDE.md's
  i18n scope covers the next-intl page/component surface).
- **Reason for deferral:** the route's only consumer is the Lightroom Classic
  publish plugin, which surfaces these strings verbatim in its own dialog and
  has no locale negotiation today; localizing the API responses would not reach
  any user in their locale until the plugin sends an Accept-Language and renders
  localized payloads. Localizing now is feature work the run-loop's deferred-fix
  rules forbid inventing.
- **Exit criterion (re-opens this item):** the Lightroom plugin gains
  localization (or any browser-based consumer starts calling this route), at
  which point the route must source messages via `getTranslations` keyed on a
  negotiated locale.

## Non-deferred confirmation
All other findings (COR-R4C3-01, PERF-R4C3-05, COR-R4C3-02, SEC-R4C3-04,
COR-R4C3-03, ARCH-R4C3-06 [folded into Task 1], TEST-R4C3-07/08/09/10 [folded
into Tasks 1/3/4/5]) are scheduled in plan-277 — nothing silently dropped.
Security/correctness findings were NOT deferred.
