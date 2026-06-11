# Plan 304 — Run-4 Cycle 16 deferred ledger

**Source review:** `.context/reviews/run4-cycle16/_aggregate.md`
**Status:** RECORDED (deferred items only — nothing here is scheduled
for this cycle; severities preserved from the review, not downgraded)

Repo-rule basis for deferral (read before deferring, per the loop's
deferred-fix rules): CLAUDE.md permits deferral for non-security /
non-correctness / non-data-loss items when a concrete exit criterion
is recorded (established ledger convention plan-274 → plan-302). The
two new items below are an INFO-grade dead-file cleanup whose removal
is a destructive action requiring explicit owner confirmation per the
user's global Destructive Action Safety rules, and an INFO-grade
brand-consistency observation. Deferred work remains bound by repo
policy when picked up (GPG-signed commits, conventional commits +
gitmoji, per-cycle gates, no suppressions).

## DEF-R4C16-A — `db/seed.ts` dead script (OBS-R4C16-A, INFO/High)

- **Citation:** `apps/web/src/db/seed.ts:1-13`;
  `apps/web/package.json:18` (`db:seed` → `scripts/seed-admin.ts`).
- **Severity/Confidence (preserved):** INFO / High.
- **Problem:** unreferenced legacy seeder with stale personal-default
  topics ('idol', 'plane'); never closes the DB pool so it would hang
  if executed directly; shadows the real `db:seed` script's purpose.
- **Reason for deferral:** the correct fix is DELETION, and file
  deletion is a destructive action that requires explicit user
  confirmation first (user-global CLAUDE.md "Destructive Action
  Safety"). No correctness/security impact while it sits unreferenced.
- **Exit criterion:** owner confirms deletion (then remove the file
  in a `chore` commit), OR any change re-references `db/seed.ts`
  (then it must be fixed: pool close + non-personal defaults).

## DEF-R4C16-B — manifest dark splash vs system default theme (OBS-R4C16-B, INFO)

- **Citation:** `apps/web/src/app/manifest.ts:22-23`
  (`background_color`/`theme_color` pinned `#09090b`);
  `app/[locale]/layout.tsx:124` (`defaultTheme="system"`, light/dark
  `themeColor` media array at :63).
- **Severity/Confidence (preserved):** INFO / High.
- **Reason for deferral:** Web App Manifest has no
  prefers-color-scheme mechanism for `background_color` (a single
  static value is a platform constraint, not a bug); the dark-first
  splash is a coherent brand choice for a photo gallery; "fixing" it
  to white would worsen the majority (dark/oled) install base.
- **Exit criterion:** user reports of jarring install splash in light
  theme, OR the manifest is next edited for any other reason — then
  add an intent comment documenting the dark-first choice.

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `8c39bac3..HEAD` touches only plan-301 progress
notes; no deferral surface modified. See
`.context/reviews/run4-cycle16/_aggregate.md` § Standing deferrals.

- DEF-R4C15-A (map marker clustering — exit ≳2k GPS photos /
  payload complaints / clustering dep approved) — un-triggered;
  carried (plan-302).
- DEF-R4C15-B (p/[id]/loading.tsx lazy sessionStorage vs SSR'd
  fallback — exit: reproduced hydration warning or white-flash
  report) — un-triggered; carried (plan-302). NOTE: COR-R4C16-03
  eliminates a DIFFERENT hydration-mismatch class (image src); the
  loading.tsx item is unrelated and stays as recorded.
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map shape;
  device-fixture acquisition) — un-triggered; carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English) — no LR change; carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no
  host nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom
  passive preventDefault; Tailwind safelist) — carried (plan-288).
  NOTE: plan-303 Task 6 edits `image-zoom.tsx` but does NOT alter
  listener passivity or the touch-move preventDefault paths —
  DEF-R4C8-C's exit criterion does not fire.
- Histogram mode-cycle aria-label — carried (plan-286).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards;
  data.ts:83; ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered; carried (plan-298).
