# Run-4 Cycle 19 — document-specialist angle

## DOC-R4C19-05 — backfill-alt-text.ts header documents a gate the code never implements — **LOW-MED / High (CONFIRMED)**

- **Citation:** `apps/web/scripts/backfill-alt-text.ts:20-24` header:
  "Requires auto_alt_text_enabled to be true in admin settings OR the
  --force flag to override." and `:24` usage line documenting
  `[--force]`.
- **Code reality:** the admin setting is **never read**;
  `generateCaption(..., /* autoAltTextEnabled: */ true)` (`:69-72`)
  hard-codes the gate open; `FORCE_FLAG` (`:36`) is only used to print
  a tip line (`:96-98`). The script therefore writes
  `alt_text_suggested` rows even when the feature is disabled in
  admin — precisely what the doc promises it will not do.
- **Authoritative-source comparison:** the sibling
  `backfill-clip-embeddings.ts:42-61` implements the exact documented
  pattern (reads `semantic_search_enabled` from adminSettings, exits 0
  unless `--force`). The alt-text script copied the doc but not the
  implementation.
- **Fix direction:** implement the documented behavior (doc is the
  contract; sibling proves the intended shape): read
  `auto_alt_text_enabled`, exit 0 with explanatory message when false
  and `--force` absent. Combine with the COR-R4C19-04 keyset fix since
  both touch the same file.

## Doc/code verification sweep (rotation surfaces)

- `backfill-cicp-recheck.ts` header "read-only: never writes to the DB
  or filesystem" — TRUE (only SELECT + detectColorSignals on files).
  Header "Idempotent / safe to run at any time" — currently FALSE in
  effect because the script crashes (COR-R4C19-03); true again after
  the tuple fix. No doc change needed.
- `backfill-color-pipeline.ts` — CLAUDE.md's "Backfill" section
  (sidecar pattern, advisory lock, idempotency, column list) matches
  the script; the `:269` tuple comment is the canonical in-repo
  documentation of the drizzle raw-execute shape. Verified accurate.
- `seed-e2e.ts` C1R-05 comment (honors IMAGE_SIZES contract) matches
  implementation (parseImageSizes fallback chain).
- `check-public-route-rate-limit.ts` header documents the GET-handler
  blind spot explicitly (`:9-11`) — accurate and appropriately scoped.
- CLAUDE.md "Common Commands" lists `npm run db:seed` as "Seed admin
  user" — accurate (upsert semantics; re-running resets the admin
  password hash to ADMIN_PASSWORD, which is the documented bootstrap
  contract).
- `package.json:10` prebuild chain (`ensure-site-config` →
  `generate-pwa-icons` → `build-sw`) matches the deploy checklist
  ("deploy/build paths now fail fast if the real file is missing").
- `migrate.js` runbook in CLAUDE.md (journal hash post-conditions,
  reconcileLegacySchema) — spot-checked against
  `scripts/migrate.js`; the three documented functions exist with the
  documented responsibilities. (Deep line-audit was done run-3; only
  drift-checked this cycle — no drift: file untouched since.)

## Standing doc deferrals

- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered this cycle; carried.
- The fix for COR-R4C19-01 should NOT require a CLAUDE.md edit: the
  tuple shape is documented at its canonical location
  (backfill-color-pipeline.ts:269) and will now also live at the
  topics.ts unwrap comment.
