# Plan 335 — Run-8 Cycle-3 fixes (MED + scheduled LOW)

**Source:** `.context/reviews/_aggregate.md` (run-8 cycle-3 fan-out, 11 agents, no failures). HEAD at planning time: `ada92ba5`.
**Commit discipline (CLAUDE.md / global CLAUDE.md):** GPG-signed (`git commit -S`), Conventional Commits + gitmoji, ONE commit per item, `git pull --rebase` then push after EACH commit, full gate run before cycle close. NO `Co-Authored-By`. No `--no-verify`, no force-push. Run `npm run typecheck --workspace=apps/web` before committing any test change.

**Context:** The prior run-8 cycle-2 batch (AGG-R8-01..13) landed clean — every fix re-verified CLOSED & behaving at HEAD by all agents. This cycle's open set is the *adjacent gaps* those fixes left (two "fixed-on-paper" items) plus a small a11y/perf cluster. No CRITICAL/HIGH-severity-HIGH-confidence defect; no plan-table hygiene needed. Total: 4 MED + the cheap scheduled LOWs below.

**GATES this run:** eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit. All must be GREEN before cycle close. DEPLOY_MODE = per-cycle (`npm run deploy` once after green).

---

## Item 1 — AGG-R8c3-03: backfill runner leaks orphaned derivative files on delete-during-reencode race (MED · 1 agent · the substantive fix)

- **Source:** ARCH-1 (architect, High confidence; mechanism verified by orchestrator).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:526-539` (the `if (signals)` UPDATE branch) and the sibling no-signals UPDATE at `:557-560`. Both UPDATE `WHERE id = ${row.id}` **unconditionally and never check `affectedRows`**.
- **Why it matters:** the backfill runner acquires the per-image processing advisory lock (`:455`) for the full re-encode + detect + UPDATE window, and `processImageFormats` writes fresh derivative files to disk. But `deleteImage` (`apps/web/src/app/actions/images.ts:538-632`) does NOT acquire that per-image lock — it deletes the DB row in a transaction, then unlinks the files best-effort. So a delete that races an active backfill re-encode of the SAME image id: the backfill writes the new derivatives, the delete removes the row + unlinks, and the backfill's `WHERE id=?` UPDATE matches 0 rows but the freshly-written derivative files REMAIN on disk → orphaned files for a deleted image, never cleaned up. The sibling upload writer (`image-queue.ts:367-382`) already handles exactly this: it checks `updateResult.affectedRows === 0` → "image was deleted during processing, cleaning up" → `deleteImageVariants(...)` for webp/avif/jpeg. The backfill runner is the only re-encode writer that does NOT mirror this guard.
- **Change:**
  1. In `admin-backfill-runner.ts`, capture the UPDATE result in BOTH branches: `const [updateResult] = await db.execute(sql\`UPDATE images SET … WHERE id = ${row.id}\`);`
  2. If `updateResult.affectedRows === 0` (row deleted mid-reencode), clean up the just-written derivative files the same way `image-queue.ts` does (`deleteImageVariants(UPLOAD_DIR_WEBP, row.filename_webp)` etc. — use the same import path the runner/queue already use), and return a NEW outcome `{ ok: false, reason: 'deleted-mid-reencode' }` (do NOT count it as `encode-failed` — it's not a failure, the image is gone).
  3. Add a `deletedMidReencode` tally to the run summary alongside the existing processed/locked/encode-failed counters so the operator sees it. Mirror the counter-partition discipline f3667858 established (the success/fatal partition test) — `deleted-mid-reencode` is neither a success nor a fatal error.
  4. NOTE on the `mysql2` result shape: `db.execute(sql\`…\`)` returns `[ResultSetHeader, …]`; `ResultSetHeader.affectedRows` is the field. Confirm the destructure matches how the runner already reads execute results elsewhere (it uses `db.execute` with no result read today — verify the ResultSetHeader path; if Drizzle's `db.execute` returns the header directly vs wrapped, match the existing codebase pattern in `image-queue.ts` which uses `db.update(...).set(...).where(...)` returning `[updateResult]`).
- **Acceptance:** a unit test simulates an UPDATE returning `affectedRows: 0` (mock `db.execute`) and asserts the runner (a) calls `deleteImageVariants` for all three formats and (b) returns `reason: 'deleted-mid-reencode'` with NO `pipeline_version` bump and NO `encode-failed` miscount. Full gate run green. This is the f3667858 mixed-run partition extended with the new outcome.

## Item 2 — AGG-R8c3-04: `text-destructive` error text fails WCAG 1.4.3 in dark mode (MED a11y · 1 agent · widest public surface)

- **Source:** DES-1 (designer, High confidence, computed ~1.99:1).
- **Where:** dark `--destructive` token (`apps/web/src/app/[locale]/globals.css:59` HSL `0 62.8% 30.6%`; oklch `40% 0.16 27` at `:124/:131`) is tuned as a button BACKGROUND (white foreground on it ≈ 9.6:1, fine) but is reused as TEXT foreground via `text-destructive` on `bg-card` across ~28 sites — including the shared `apps/web/src/components/ui/alert.tsx:13` primitive (`text-destructive bg-card …`), the login error, and `role="alert"` validation messages. Dark red text on near-black card ≈ 1.99:1, fails 4.5:1.
- **Change:** introduce a dedicated text token that is light enough for AA-on-card in BOTH modes, OR apply the established amber-style dark mirror. Preferred (least churn, follows the existing `dark:text-amber-400` convention in the repo):
  1. Add a `--destructive-text` CSS var: light mode keep the current red (`0 72.2% 50.6%` passes on white card ≈ 4.0:1 — VERIFY; if it's marginal use `0 72% 45%`), dark mode use a LIGHTER red (e.g. `0 90% 71%` ≈ Tailwind red-400, which passes ≈ 7:1 on the dark card). Add to `@layer base` :root and `.dark` blocks, plus the oklch override block. Wire a Tailwind `text-destructive-text` utility (or reuse via `text-[hsl(var(--destructive-text))]`).
  2. In `ui/alert.tsx:13` destructive variant, change the foreground from `text-destructive` to the new text token (keep `bg-card`). Audit the other loose `text-destructive` TEXT sites (login error, validation `role="alert"`, any `<p className="text-destructive">`) and switch them to the text token. Do NOT change sites where `destructive` is a BUTTON background or an ICON-only color where contrast already passes.
  - If introducing a new CSS var is judged too invasive for one cycle, the acceptable minimal fix is a blanket `dark:` mirror on the alert primitive + the loose text sites (`text-destructive dark:text-red-400`), matching the amber pattern. Prefer the token for consistency.
- **Acceptance:** the destructive ERROR TEXT (alert primitive + login + validation) computes ≥ 4.5:1 on its real background (`bg-card`) in BOTH light and dark. Button backgrounds (white-on-destructive) unchanged. Manual contrast check with the computed token hexes. No new lint/type errors.

## Item 3 — AGG-R8c3-05: home page runs two uncached heavy GROUP_CONCAT queries per request (MED perf · 1 agent)

- **Source:** PERF-1 (perf-reviewer, High confidence).
- **Where:** `apps/web/src/app/[locale]/(public)/page.tsx:92` `generateMetadata` → `getImagesLite(undefined, …, 1, 0)` (full `LEFT JOIN imageTags + tags` + `GROUP BY images.id` + `GROUP_CONCAT` + filesort, just to read the latest image's `id`/`title` for the OG card); `:162` body → `getImagesLitePage(…)`. Neither `getImagesLite` (`apps/web/src/lib/data.ts:728`) nor `getImagesLitePage` (`:818`) is `cache()`-wrapped (confirmed — plain `async function`), so BOTH hit MySQL on every home render.
- **Why it matters:** `/p/[id]` correctly routes both metadata + body through `getImageCached` (one query, deduped). The home metadata path needs ONLY `id` + `title` of the latest processed image — the tag JOIN/GROUP_CONCAT/filesort is entirely wasted work on the hottest public page.
- **Change:** add a minimal, `cache()`-wrapped data accessor in `data.ts` — `getLatestImageForOgCached()` — that selects just `{ id, title }` from `images WHERE processed = true ORDER BY <homepage sort> LIMIT 1` (reuse the existing homepage composite index `(processed, capture_date, created_at)` — no tag JOIN, no GROUP BY). Use it in `generateMetadata` to build the `/api/og/photo/${id}` URL. Keep the body's `getImagesLitePage` as-is (it legitimately needs the page of tiles + counts).
  - Do NOT change `getImagesLite`'s shape (it's used elsewhere and locked by `data-tag-names-sql.test.ts` via `tagNamesAgg`). Add a new dedicated function instead.
- **Acceptance:** the home metadata path issues a single `LIMIT 1` query with no `GROUP_CONCAT`/`imageTags` JOIN; the OG card still resolves to the latest photo's `/api/og/photo/${id}` (AGG-R8-02 behavior preserved). A test asserts the new accessor's SQL has no `imageTags`/`GROUP_CONCAT` (fixture-style, mirroring `data-tag-names-sql.test.ts`). Full gate run green. Manual: `curl` the home page, confirm `og:image` still points at `/api/og/photo/<id>`.

## Item 4 — AGG-R8c3-06: 24px admin alias-remove button + audit cannot see Tailwind scale tokens (MED a11y · 1 agent · 2nd audit blind spot)

- **Source:** DES-2 (designer, High confidence, static).
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:330-337` — a `<button type="button">` (delete-alias control: `onClick`, `focus:ring`, `hover:text-destructive`) styled `min-h-6 min-w-6` (24px; inner `<X className="h-3 w-3">` is 12px), below the CLAUDE.md 44px floor. The `apps/web/src/__tests__/touch-target-audit.test.ts` FORBIDDEN regex matches `h-8/h-9/h-10` literals + bracket `min-h-[NNpx]`, but STRUCTURALLY CANNOT match Tailwind SCALE tokens like `min-h-6`/`size-6`/`h-6` — a 2nd enforcement blind spot mirroring the raw-checkbox blind spot AGG-R8-03 closed.
- **Change:**
  1. Bump the button wrapper to `min-h-11 min-w-11` (keep the 12px `X` visible; the button provides the 44px hit area, consistent with the repo's icon-in-larger-hitzone pattern). Keep `rounded-full inline-flex items-center justify-center`.
  2. Extend `touch-target-audit.test.ts` FORBIDDEN set to flag sub-44 Tailwind scale tokens on interactive elements: `min-h-{1..10}` / `min-w-{1..10}` / `size-{1..10}` / standalone `h-{1..10}`/`w-{1..10}` on `<button>`/`<Button>`/`role="button"` and raw-checkbox wrappers, where no `≥ h-11/min-h-11/size-11` override is present. Follow the existing multi-line-tag normalization + the `KNOWN_VIOLATIONS` exemption mechanism. Per CLAUDE.md "Adding a documented exemption", any intentional sub-44 admin control surfaced by the new pattern must be added to `KNOWN_VIOLATIONS` with a re-open criterion — re-use the existing "admin keyboard-primary on desktop" rationale where it genuinely applies, but the alias button itself should be FIXED (it's a pointer-primary chip control, not keyboard-primary).
- **Acceptance:** the alias-remove button renders a ≥44px hit area; `npm test --workspace=apps/web` passes including the extended audit; introducing a synthetic `min-h-6` `<button>` in a scanned file trips the new pattern (prove 0→1, then revert the synthetic). Reconcile any pre-existing scale-token hits the new pattern surfaces (either fix them or add a justified `KNOWN_VIOLATIONS` entry). Run `npm run typecheck` before committing the test change.

## Item 5 — AGG-R8c3-01: NCLX code-2 `isHdr` upload-rejection side-effect — correct the commit claim + pin the branch (MED · 2 agents)

- **Source:** CRT-1 (critic, High on mechanism) + code-reviewer (noted the untested branch).
- **Where:** `apps/web/src/lib/color-detection.ts:344` (`transferFunction = inferTransferFunction(iccName, null, bitDepth)`) + `:382-386` (per-field NCLX guard) + `:389` (`isHdr = transferFunction === 'pq' || 'hlg'`); upload gate at `apps/web/src/app/actions/images.ts:283` (`if (data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest) → reject`).
- **Why it matters:** the AGG-R8-06 fix (74235265) correctly stopped NCLX code-2 (Unspecified) from clobbering ICC-derived transfer/matrix. BUT a side-effect: before the fix, an NCLX box with transfer=code-2 forced `transferFunction='unknown'` → `isHdr=false`; after, the ICC-name-derived value survives, and `inferTransferFunction` returns `'pq'`/`'hlg'` for any ICC whose NAME contains `pq`/`st2084`/`hlg`/`arib`/`hybrid log`. So a HEIF/AVIF with NCLX transfer=code-2 + a PQ/HLG-named ICC now derives `isHdr=true` → REJECTED at upload when `allow_hdr_ingest=false` (default), where it previously ingested as SDR. The commit message claims "no delivered-byte impact" — FALSE (it's now delivered-NOTHING for that rare input). Trigger is RARE (NCLX code-2 transfer + PQ/HLG-named ICC is an unusual pairing).
- **Disposition decision:** the new rejection is **arguably CORRECT** — a source whose ICC profile name asserts PQ/HLG is plausibly genuinely HDR, and the SDR-only pipeline rejecting it under `allow_hdr_ingest=false` is the documented honest behavior. We therefore SCHEDULE (not revert): (a) correct the inaccurate "no delivered-byte impact" claim, and (b) add a test pinning the branch so the behavior is intentional and locked, not accidental.
- **Change:**
  1. Add a `color-detection.test.ts` case: NCLX(primaries=12 DisplayP3, transfer=2 Unspecified, matrix=2 Unspecified) + an ICC whose name contains `PQ` (or `ST 2084`) → assert `transferFunction === 'pq'` AND `isHdr === true` (the ICC-name value survives the code-2 guard). Add the inverse: NCLX(…, transfer=2, …) + an sRGB-named ICC → `transferFunction === 'srgb'`, `isHdr === false` (already covered by the AGG-R8-06 test — confirm).
  2. Update the code comment near `color-detection.ts:389` (and, if it still says "no delivered-byte impact" anywhere, the relevant doc) to note: "NOTE: when an NCLX box leaves transfer Unspecified (code 2) but the ICC NAME asserts PQ/HLG, the ICC-derived transfer now survives → isHdr=true → upload rejected when allow_hdr_ingest=false. This is intentional (an HDR-named source is treated as HDR by the SDR-only pipeline) and is pinned by color-detection.test.ts." Do NOT edit the historical commit message (immutable); instead correct any LIVE doc/comment that repeats the false claim.
- **Acceptance:** the new test passes and FAILS if the code-2 per-field guard is reverted to `?? 'unknown'` (prove by reasoning or transient revert). Comment/doc no longer claims "no delivered-byte impact" for this branch. Full gate run green.

## Item 6 — AGG-R8c3-02: migrate the third `sanitizeForOg` copy + fix the lying docstring (LOW security hygiene · 2 agents)

- **Source:** CRT-2 (critic, High) + tracer-adjacent.
- **Where:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:42-44` — a local `sanitizeForOg` used for JSON-LD that calls ONLY `stripUnicodeFormatting()` (no C0 control strip), with a docstring (`:34`) claiming "Matches the `sanitizeForOg` in the OG image route." The shared `apps/web/src/lib/og-sanitize.ts:28` `sanitizeForOg` strips Unicode formatting AND C0 control chars (`OG_C0_CONTROL_CHARS`). So the docstring is now FALSE and the JSON-LD path is weaker.
- **Why it matters:** non-exploitable (`JSON.stringify` escapes C0 chars in string values + `safeJsonLd` escapes `</script>`), pure defense-in-depth + doc honesty. But it defeats the AGG-R8-13 "one sanitizer, no copies" discipline and leaves a lying comment.
- **Change:** import `sanitizeForOg` from `@/lib/og-sanitize` into `p/[id]/page.tsx`, delete the local copy + its docstring. Verify the import is client-safe (it is — `og-sanitize.ts` only imports `stripUnicodeFormatting` from `validation.ts`, both pure/client-safe). Update `sanitize-for-og-global.test.ts` (or add a case) so the JSON-LD page's sanitizer is pinned to the shared one (assert the imported symbol / a C0-strip behavior), closing CRT-5's "passes for the wrong reason" gap for this site.
- **Acceptance:** `p/[id]/page.tsx` uses the shared `sanitizeForOg` (no local copy); JSON-LD now also strips C0 controls; a test asserts a C0-laden title is stripped in the JSON-LD path. Full gate run green.

## Item 7 — AGG-R8c3-07 + AGG-R8c3-08: amber dark-mode contrast (LOW a11y · 1 agent · 2 one-line fixes)

- **Source:** DES-3 + DES-4 (designer, High confidence, computed).
- **Where:** (a) `apps/web/src/components/histogram.tsx:608` `<span className="ml-1 text-amber-700 font-medium">({sRGB preview})</span>` — NO dark variant, ≈ 3.96:1 dark (PUBLIC, photo viewer). (b) `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:674` `<p className="text-xs text-amber-600 font-medium">` — NO dark variant, ≈ 3.19:1 (admin).
- **Why it matters:** both fail WCAG 1.4.3 small-text 4.5:1 in dark mode. The repo already has the correct sibling pattern: `color-details-section.tsx:506/524/540` use `text-amber-700 dark:text-amber-300`; `sales-client.tsx:93` + `settings-client.tsx:306/338` use `dark:text-amber-400`.
- **Change:** (a) `histogram.tsx:608` → `text-amber-700 dark:text-amber-300`. (b) `settings-client.tsx:674` → `text-amber-700 dark:text-amber-400` (match the same file's other amber sites). Verify both compute ≥ 4.5:1 in dark.
- **Acceptance:** both amber warnings ≥ 4.5:1 in dark mode (and still pass light). No lint/type errors. (Both are JSX className edits — no test change, but run the touch-target audit + full suite to confirm no collateral.)

## Item 8 — AGG-R8c3-14: CLAUDE.md doc-completeness batch (LOW doc · 1 agent · one patch)

- **Source:** document-specialist DOC-1..4 (High confidence; incompleteness, not falsehoods).
- **Where / Change (one commit, four edits to CLAUDE.md):**
  1. DOC-1: SW section (`~:294`) — note the ETag HEAD probe is now bounded by `AbortSignal.timeout(300ms)` (serve-stale on abort), citing `HEAD_REVALIDATE_TIMEOUT_MS` (AGG-R8-05).
  2. DOC-2: Touch-Target "Pattern coverage" list (`~:520-528`) — add the raw `<input type="checkbox|radio">` scanner (`scanRawCheckboxes`, AGG-R8-03); and, AFTER Item 4 lands, the sub-44 scale-token pattern.
  3. DOC-3: the bidi-strip security bullet (`~:178`) — add the runtime `lib/og-sanitize.ts` / `sanitizeForOg` defense-in-depth layer used by both OG image routes (AGG-R8-13).
  4. DOC-4: document that the home-page `og:image` points at `/api/og/photo/${id}` (1200×630 Satori card with on-disk fallback), not the base JPEG (AGG-R8-02).
- **Acceptance:** CLAUDE.md prose matches HEAD code for these four areas. (Doc-only — `~/.claude/**`/`CLAUDE.md` direct edit is allowed; still run the full gate suite since CLAUDE.md is not code but the commit is part of the cycle.)

## Item 9 — AGG-R8c3-11 + AGG-R8c3-16(a): test depth on freshly-landed fixes + tighten the comment-match tripwire (LOW test · 3 agents)

- **Source:** test-engineer TEST-1/2/3 + code-reviewer COR-1/COR-3 + critic CRT-5 (3-agent agreement on the home-OG-route gap).
- **Where / Change (may be 1-2 commits):**
  1. TEST-1/COR-1: add the HOME OG route (`api/og/route.tsx`) to the `sanitize-for-og-global.test.ts` `it.each` list (or a structural grep) so its `sanitizeForOg` application is pinned — currently only the photo route is. (Item 6 covers the JSON-LD page; this covers the home OG IMAGE route.)
  2. TEST-2: add a `width: 0` / `-1` / `NaN` case to the existing backfill `fatal-counters` harness asserting the AGG-R8-09 skip → `encode-failed`, NO version bump, stays a candidate. (Distinct from Item 1's `deleted-mid-reencode` test.)
  3. TEST-3: extend `sw-template-contract.test.ts` to slice-and-match the HEAD-probe options for `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` so dropping the `signal:` fails the suite (the reference `sw-cache.ts` doesn't implement HEAD probing, so the template is the only copy).
  4. COR-3/CRT-5: strengthen `migrate-reconcile-coverage.test.ts:79,143` from bare `MIGRATE_SRC.includes(name)` to a statement-token match (e.g. require the name to appear in a `CREATE INDEX`/`ALTER TABLE`/column-DDL context, not a comment).
- **Acceptance:** each new/strengthened test FAILS if its target fix is reverted (prove by reasoning or transient revert). Full gate run green. Run `npm run typecheck` before committing.

## Item 10 — AGG-R8c3-16(b): localize the lone `retryFailedImage` error string (LOW i18n · 1 agent)

- **Source:** code-reviewer COR-4.
- **Where:** `apps/web/src/app/actions/images.ts:1085` — `retryFailedImage` returns a hardcoded `'Invalid image ID'`; every sibling uses `t('invalidImageId')`.
- **Change:** replace with `t('invalidImageId')` (the key already exists — confirm it's loaded in this action's scope; `retryFailedImage` likely already has a `getTranslations('serverActions')` in scope or add one). Confirm `invalidImageId` exists in both `en.json` and `ko.json` (it does — used by `deleteImage`).
- **Acceptance:** the string is localized; no new untranslated-key lint warnings; full gate run green.

---

## Deferred / record-only (see plan-336-run8-cycle3-deferred.md)

AGG-R8c3-09 (encode-test parallelism flake — test-infra isolation, no logic defect), AGG-R8c3-10 (SW meta lost-update — best-effort by design), AGG-R8c3-12 (lib→app layering inversion — no live cycle), AGG-R8c3-13 (triplicated ICC token ladder — DRY/maintainability), AGG-R8c3-15 (stale KNOWN_VIOLATIONS count — test precision), AGG-R8c3-17 (design polish ×3), AGG-R8c3-A1..A5 (record-only perf/arch tradeoffs), AGG-R8c3-OWNED-1 (Stripe ACH — already plan-316). Each is recorded there with severity preserved + exit criterion.

---

## Progress

| Item | Finding | Severity | Status |
|---|---|---|---|
| 1 | AGG-R8c3-03 backfill orphaned-file leak on delete-race | MED | DONE |
| 2 | AGG-R8c3-04 text-destructive dark contrast 1.99:1 | MED | DONE |
| 3 | AGG-R8c3-05 home page two uncached heavy queries | MED | DONE |
| 4 | AGG-R8c3-06 24px alias button + scale-token audit blind spot | MED | DONE |
| 5 | AGG-R8c3-01 NCLX code-2 isHdr side-effect — pin branch + fix claim | MED | DONE |
| 6 | AGG-R8c3-02 third sanitizeForOg copy + lying docstring | LOW | DONE |
| 7 | AGG-R8c3-07/08 amber dark-mode contrast ×2 | LOW | DONE |
| 8 | AGG-R8c3-14 CLAUDE.md doc-completeness ×4 | LOW | DONE |
| 9 | AGG-R8c3-11 + 16(a) test depth ×3 + tripwire | LOW | DONE |
| 10 | AGG-R8c3-16(b) localize retryFailedImage string | LOW | DONE |
