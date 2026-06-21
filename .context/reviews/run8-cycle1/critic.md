# CRITIC — Run-8 Cycle-1 — adversarial review of the Stripe paid-download REMOVAL

**HEAD:** `47b1e21f`  **Range under review:** `6c5e0b61..47b1e21f` (5 commits)
**Mode:** THOROUGH (no escalation to ADVERSARIAL — zero CRITICAL, zero MAJOR found; the removal is genuinely clean)
**Verdict:** **ACCEPT** — the removal is clean. One LOW vestigial-test-data finding + one INFO process-artifact (stale deferred register). No correctness/security/data-loss issue.

---

## VERDICT: ACCEPT

**Overall assessment:** This is a subtractive change executed cleanly. The big deletion landed in `6c5e0b61` (17 test files + 10 source files: routes/libs/actions/pages); the 4 follow-up commits stripped the UI/wiring (`6c300402`), dropped the DB objects via migration 0023 + reconcile (`e172c4fc`, `47b1e21f`), and cleaned docs/i18n/deps (`961a7f1f`). All 5 adversarial hypotheses were FALSIFIED FROM CODE (= clean) except one harmless vestigial test-fixture property. Typecheck passes (exit 0); the 5 changed test files pass (94/94); both security lint gates pass.

**Pre-commitment predictions vs reality:**
1. *Predicted:* CLAUDE.md doc-code drift is the biggest finding. **WRONG** — CLAUDE.md, both READMEs, and `.env.local.example` are FULLY cleaned (verified by zero-hit grep). The cleanup commit `961a7f1f` updated them correctly.
2. *Predicted:* deferred register has moot entries. **CORRECT** — but it is a frozen historical artifact (INFO, not a code defect).
3. *Predicted:* migration 0023 fine on fresh, need to verify reconcile. **Reconcile is correct + idempotent** (survived).
4. *Predicted:* a surviving test/comment references a deleted concept. **CORRECT, exactly one** — `serve-upload-settings-debounce.test.ts:34`.
5. *Predicted:* free-download path intact, null-safety needs tracing. **CORRECT — intact and null-safe.**

---

## Adversarial hypotheses — falsification results

### H1 — "The removal is complete, no dangling reference." → **SURVIVED (clean)**
Evidence (all grep/read-verified at HEAD `47b1e21f`):
- LIVE source (`app/`, `lib/`, `components/`, `db/`) residual paid-term hits: **ZERO** (`stripe|license_tier|licenseTier|entitlement|checkout|download-token|download-interstitial|paid-download`).
- `app/actions.ts` barrel: clean — no `sales`/`checkout`/`entitlements`/`licenseTier` export.
- Deleted route dirs gone: `api/checkout`, `api/download`, `api/stripe`, `admin/(protected)/sales` — all `No such file`.
- Deleted libs gone: `lib/stripe.ts`, `lib/download-tokens.ts`, `lib/license-tiers.ts`, `lib/download-interstitial.ts`, `actions/sales.ts`.
- No dynamic `import()` / `lazy()` to any deleted path.
- `schema.ts`: no `license_tier`/`entitlements`. `bulk-edit-types.ts`: `LICENSE_TIERS`/`LicenseTier` removed; no live dangling ref.
- `bulk-edit-dialog.tsx`: no leftover license UI/import.
- i18n `en.json`/`ko.json`: no `stripe.*`/`checkout`/`license` keys.
- `package.json`: `stripe` dependency removed.
- `images.ts` bulk-update audit payload (`:1051-1059`) is well-formed after `licenseTierMode` removal — no trailing-comma / half-removed object.
- Removed checkout rate-limit helpers (`preIncrementCheckoutAttempt`, `checkoutRateLimit`, etc.) have **no live caller**.

### H2 — "The free-download path still works." → **SURVIVED (clean)**
Trace, end-to-end:
- `photo-viewer.tsx:176` / `info-bottom-sheet.tsx:154`: `downloadHref = image.filename_jpeg ? imageUrl('/uploads/jpeg/${filename_jpeg}') : null` → resolves to a real static derivative under `public/uploads/jpeg/` (served by Next static server; `serve-upload.ts` fallback). `avifDownloadHref` analogous for `/uploads/avif/`.
- Render gate simplified from `{downloadHref && (!image.license_tier || image.license_tier === 'none') && (` → `{downloadHref && (` — the license gate (referencing a now-deleted field) was removed; the **null-safety gate is preserved**. No button-renders-with-null-href regression.
- `download` attr has a fallback (`?? photo-${image.id}.${ext}`), so never null.
- The removed checkout `onClick` fetch handler / Buy button JSX was deleted *whole* (not just its body) — no orphaned/broken click handler. The `<a>` anchors carry no `onClick`/`preventDefault`.
- No path streams the on-disk ORIGINAL to a user: `serve-upload.ts:15` `ALLOWED_UPLOAD_DIRS = {jpeg, webp, avif}` excludes `original`; the only remaining reader of `data/uploads/original/` is `embeddings.ts:132` (server-side CLIP, admin-only, never streams bytes).

### H3 — "Migration 0023 correct on BOTH fresh + incremental DBs." → **SURVIVED (clean)**
- `0023_remove_paid_downloads.sql`: `DROP TABLE IF EXISTS entitlements` (valid MySQL 8 idempotent) + bare `ALTER TABLE images DROP COLUMN license_tier` (unguarded — correct: drizzle runs each .sql exactly once via hash, and on both fresh + incremental, 0008/0013 run/baseline before 0023 so the targets always exist). FK-safe: dropping child table `entitlements` first removes its FK to images; `license_tier` is a plain varchar (no FK).
- `_journal.json`: 0023 entry present, `when=1782000000000` **strictly greater** than the prior max (1781687094232 @ idx 22) → drizzle's `created_at < folderMillis` cursor WILL apply it on an incremental DB (no silent-skip), and `runMigrations`' post-condition asserts the hash lands or the deploy fails loud.
- Reconcile path (`migrate.js`): the .sql never runs on an existing DB; the authoritative drop lives in `reconcileLegacySchema` at `:627-628`, **running LAST** after all ensureColumn/Index/FK adds → converges to the post-0023 schema. `dropTableIfPresent` = `DROP TABLE IF EXISTS` (idempotent); `dropColumnIfPresent` (`:215-222`) guards on `columnInfo` (INFORMATION_SCHEMA) → idempotent, no double-drop. `:370` and `:596` confirm license_tier/entitlements are no longer re-added → **no add-then-drop / drop-then-recreate hazard.**
- Migration 0023 .sql comment is accurate and matches the implementation.

### H4 — "CLAUDE.md / README still accurate." → **SURVIVED (clean) — my #1 prediction was WRONG**
- LIVE `CLAUDE.md` @ HEAD: **zero** hits for `stripe|entitlement|license_tier|checkout|/sales|paid-download|async_payment|downloadTokenHash|interstitial|money-taken|US-P54|card-only|payment_method_types`. The `entitlements` schema row, the "paid-download route streams" GPS phrasing, and `checkout` in the rate-limit bucket lists were all removed (commit `961a7f1f`, 3 hunks).
- Root `README.md`: only Apache-2.0 software-license hits (legitimate). `apps/web/README.md`: zero paid hits. `.env.local.example`: zero `STRIPE`/`LICENSE`/`webhook` hits.
- NOTE: the CLAUDE.md injected into THIS session's system-reminder is the PRE-removal copy (still shows the entitlements row, async_payment warning, card-only pin). The on-disk HEAD file is the cleaned version. The drift is in the reviewer's injected context, not on disk.

### H5 — "No surviving test orphaned / asserts deleted behavior." → **FELL (one LOW vestigial finding)** — see F-R8C1-01.
The intentional test edits are all correct:
- `bulk-update-images.test.ts`: `licenseTier` cases REPLACED with `description` equivalents (incl. the set-clause assertion rewired `license_tier`→`description`); the "rejects invalid license tier" case removed. Structural coverage preserved, not weakened.
- `check-public-route-rate-limit.test.ts`: the fixture's sample helper `preIncrementCheckoutAttempt` swapped to `preIncrementShareAttempt` (another valid helper). Lint-detection intent preserved, NOT weakened.
- `settings-hash.test.ts`: removed two `licensePrices` fixture lines — correct.
- `lr-upload-hdr-gate.test.ts`: comment ref to deleted `stripe-webhook-source.test.ts` updated.
- The ONE miss: `serve-upload-settings-debounce.test.ts:34` (F-R8C1-01).

---

## Findings

### F-R8C1-01 [LOW, conf HIGH, confirmed] — vestigial `licensePrices` in a test config fixture
**Where:** `apps/web/src/__tests__/serve-upload-settings-debounce.test.ts:34`
```
licensePrices: { editorial: 0, commercial: 0, rm: 0 },
```
**Why:** `licensePrices` was removed from the `GalleryConfig` type (verified: zero hits in `gallery-config.ts` / `gallery-config-shared.ts`; the resolver block was deleted in `6c300402`). The sibling `settings-hash.test.ts` had this exact fixture line removed in the same cleanup — this file was MISSED, so the two cleanups are inconsistent. `FAKE_CONFIG` (`:25-42`) is an **untyped object literal** returned from `vi.fn(async () => FAKE_CONFIG)` mocking `getGalleryConfig`, so TypeScript applies no excess-property check (inferred return type) → the dead property does NOT fail `typecheck:app` (confirmed: exit 0) and `serveUploadFile` ignores it at runtime (5/5 files, 94 tests pass).
**Concrete scenario:** a future contributor adds `satisfies GalleryConfig` or `: GalleryConfig` to `FAKE_CONFIG` to harden the mock (a reasonable hygiene change) → tsc then errors on the unknown `licensePrices` property, a confusing failure with no live referent. Today it is pure dead data that misleads a reader into thinking `licensePrices` is still part of config.
**Fix:** delete line 34.
**Severity rationale (Realist Check):** no data/security/financial impact; detection is immediate at next typecheck-with-annotation; zero runtime effect. Correctly LOW (a hair above INFO only because it is the sole code-tree inconsistency the removal left and the matching sibling fixture WAS cleaned).

### INFO-R8C1-02 [INFO, conf HIGH, confirmed] — stale entries in the run-7 cycle-6 deferred register (MOOT after removal)
**Where:** `.context/plans/run7-cycle6/deferred.md`
**Why:** several carried deferrals reference code that the removal DELETED, so their exit criteria can never fire:
- **ARCH-R7C2-01** (`charge.refunded` gap @ `api/stripe/webhook/route.ts:88`) — file deleted → **MOOT**.
- **TE-R7C2-02** (Stripe webhook source-vs-behavioral @ `stripe-webhook-source.test.ts` + `checkout-route.test.ts`) — both files deleted → **MOOT**.
- **RES-R7C6-01** (HEIC anomaly GPS-strip fall-through, escalate-to-HIGH "if reachable, privacy/paid-download") — its sole reachability vector ("the paid-download route streams the original") is GONE. Post-removal NO path serves `data/uploads/original/` to any user (`ALLOWED_UPLOAD_DIRS` excludes `original`; only `embeddings.ts:132` reads it, server-side). DB columns were already nulled. → the privacy concern is **FULLY MOOT**; the residual is now at most an on-disk-only metadata curiosity with no consumer.
- (Still LIVE / NOT moot: TE-R7C2-03 semantic-route null-skip; TE-R7C2-04 audit truncation; the LOW topology/locking observations; DEF-C11-01 search input height.)
**Fix:** when the run-8 deferred register is authored, mark ARCH-R7C2-01 + TE-R7C2-02 as RESOLVED-BY-REMOVAL and downgrade/close RES-R7C6-01 (reachability vector eliminated). Do NOT carry them forward as open.
**Note per task constraints:** this is flagged as the requested "carried deferrals now MOOT" observation, NOT re-filed as a new finding. It is a process artifact (frozen historical doc), not a code defect — INFO only.

---

## What's missing (gap analysis — actively hunted, none material)
- Nothing serves the un-stripped original anymore (verified) — the removal *closed* a latent privacy surface rather than opening one.
- No half-removed object literals, no trailing-comma syntax hazards in the touched audit/payload sites.
- No orphaned i18n keys, no orphaned rate-limit exports, no orphaned barrel exports.
- No dynamic-import / JSX reference to a deleted module.
- Migration journal monotonicity for 0023 is satisfied (the pre-existing idx-7 non-monotonic entry is a known, hash-path-irrelevant historical artifact).

## Multi-perspective notes
- **Executor:** a contributor following the cleaned CLAUDE.md/README would not be misled — the docs no longer describe a paid-download feature. Good.
- **Skeptic (strongest counter-argument I could build):** "the unguarded `DROP COLUMN license_tier` will crash on a DB where 0008 didn't apply." Refuted: on the drizzle path 0008 always precedes 0023; on the reconcile path the .sql never runs and `dropColumnIfPresent` is information_schema-guarded. No order/double-drop hazard exists.
- **Ops/new-hire:** the SW version stamp was refreshed (`3f687985`) post-removal, so the service worker cache busts correctly — no stale paid-UI shell served from cache.

## Do-NOT-re-file (per task constraints, verified still non-issues)
MED-R7C2-01 (histogram clip %), REJ-R7C3-01 (indexSize), NCLX matrix/transfer pin class (EXHAUSTED), NF-R7C4-01/NF-R7C5-01/NF-R7C6-01 — none re-litigated here.

## Verdict justification
ACCEPT. Run-7 reached genuine convergence and this is a disciplined subtractive change. Every adversarial hypothesis was falsified from code except one harmless vestigial test-fixture property (F-R8C1-01, LOW) and the expected-but-now-confirmed stale deferred register (INFO-R8C1-02). No CRITICAL/MAJOR; THOROUGH mode never needed escalation. The truthful success condition the task named — "the removal is clean, the only finding is stale docs" — is *almost* met: the docs (CLAUDE.md/README/env) turned out CLEANER than predicted, and the single code-tree residue is one dead test-fixture line.

**Highest-signal item:** F-R8C1-01 (`serve-upload-settings-debounce.test.ts:34`) — the only place in the entire live source+test tree where a deleted paid-download concept survives; a one-line delete.

## Open questions (unscored)
- None. Typecheck (exit 0), 94/94 changed tests, and both security lint gates passing were observed directly; nothing left needing validation.
