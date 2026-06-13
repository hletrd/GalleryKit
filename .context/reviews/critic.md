# Critic — Multi-Perspective Skeptical Review (run-8 cycle-4 follow-on)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD reviewed:** `ce0029aa` (working tree clean except concurrent reviewer `.md` files)
**Angle:** seams BETWEEN concerns — fixes that created inconsistency elsewhere, commit-message overstatement, tests that pass for the wrong reason, asymmetric duplicated logic.
**Scope:** the `0017a34e`..`ce0029aa` fix batch that just closed the 17 cycle-3 findings (`_aggregate.md`), verified line-by-line against the actual code, NOT on the commit's word.

## VERDICT: ACCEPT-WITH-RESERVATIONS

The cycle-3 fix batch is genuinely high quality — most fixes are complete, correct, and well-tested. Independent verification confirms the two substantive behavior-touching fixes (backfill orphan-cleanup, NCLX isHdr) hold across all interleavings, and the wide a11y token migration is contrast-correct on every surface I computed (including tinted backgrounds the aggregate didn't check). **One MAJOR finding:** the new touch-target audit scale-token regex (commit `d70c1d98`) has empirically-verified FALSE POSITIVES on legitimate `max-h-*`/`max-w-*` Button utilities — a regression gate that will block valid code with a misleading message. Two LOW findings (a pre-existing upload-worker cleanup asymmetry the new code's "mirror" claim exposes; a commit-message overstatement). Everything else verified clean.

**Pre-commitment predictions vs. actual:** I predicted the batch likely left 1-2 adjacent gaps (the per-cycle pattern), with the backfill cleanup and the audit regex as top risk candidates. Actual: backfill cleanup is CORRECT (prediction wrong — pleasant surprise); the audit regex IS the gap (prediction correct). The og-sanitize "fourth copy" prediction came up empty — migration is complete and adequately pinned across two test files. The a11y "token wrong in light mode / missed sites" prediction came up empty — fully complete.

---

## MAJOR FINDINGS

### CRT-1 (MAJOR, High) — touch-target audit scale-token regex false-positives on `max-h-*` / `max-w-*` Buttons; the new enforcement gate will block legitimate code with a lying message

- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts` — the 4 new FORBIDDEN patterns added by commit `d70c1d98` (AGG-R8c3-06 / DES-2), e.g.:
  ```
  /<Button\b(?![^>]*\b(?:h-1[12]|...)\b)[^>]*\bclassName=["'][^"']*\b(?:min-h|min-w|size|h|w)-(?:[1-9]|10)\b/
  ```
- **The seam:** the match body alternation includes a bare `h` and `w` guarded only by `\b`. A word boundary exists between the `-` and the `h`/`w` inside compound tokens like `max-h-10`, `max-w-9`, so `\bh-10\b` matches the `-h-10` substring of `max-h-10`. The negative lookahead only suppresses the match when a 44px+ token (`h-11`/`min-h-11`/`size-11`/etc.) is ALSO present — a `max-h-10` constraint with no explicit height floor is flagged.
- **Empirically verified** (Node, against the exact committed regex):
  - `<Button className="max-h-10 px-4">` → **FLAG** (false positive — max-height does not shrink rendered height)
  - `<Button className="max-w-9">` → **FLAG** (false positive)
  - `<Button className="overflow-h-8">` → **FLAG** (false positive on any `*-h-N≤10` compound)
  - `<Button className="min-h-6 min-w-6">` → FLAG (true positive — intended)
  - `<Button className="h-11 w-11">` → pass (correct)
  - `leading-9` / `whitespace-nowrap` → pass (correct — no `h-`/`w-` boundary)
- **Why it passes today (and why it's latent):** `grep -E '<Button[^>]*max-[hw]-(?:[1-9]|10)'` over `components/` + admin returns ZERO current matches, so the suite is green. The false positive is dormant until a developer adds a legitimate `max-h-N`/`max-w-N` (N≤10) constraint to a Button — a common pattern (scrollable dropdown trigger, clamped-height action button).
- **Failure scenario:** developer adds `<Button className="max-h-10 overflow-y-auto">` (valid — caps a button's height, does not set a sub-44 floor). CI fails with `'<Button className="...{min-h|min-w|size|h|w}-1..10..."> scale token renders ≤40 px — below 44 px floor'`. The message is FALSE (the button renders ≥44px from its variant floor; `max-h` is a ceiling). The developer either reverse-engineers the regex or — worse — adds a bogus `min-h-11` to silence the gate, learning to distrust the audit. A regression gate that cries wolf erodes the very enforcement it provides.
- **Why MAJOR (Realist Check applied):** test-only, immediate CI detection, no production/user impact, no data/security risk — that caps severity below CRITICAL. But it's more than cosmetic: a false-positive in a *security/a11y enforcement gate* with a lying diagnostic actively trains developers to add silencing tokens, which defeats future true-positive detection. Mitigated by: test-only + immediate detection.
- **Fix:** anchor the alternation so bare `h`/`w` only match at a className-token start, not after another prefix. Either (a) require a leading boundary that is whitespace or quote (not `-`): change `\b(?:min-h|min-w|size|h|w)-` to `(?:^|["'\s])(?:min-h|min-w|size|h|w)-` within the className capture; or (b) drop bare `h`/`w` from the alternation and rely on `min-h`/`min-w`/`size`/`h-`/`w-` matched only when preceded by a token boundary; or (c) explicitly exclude the `max-` prefix with a `(?<!max-)` lookbehind before the `h`/`w` branch. Add the three false-positive cases above as `pass` assertions in the test's own self-check block so the regex can't regress into over-matching again.

---

## LOW FINDINGS

### CRT-2 (LOW, High) — the upload-queue worker's delete-during-processing cleanup leaks non-default-size variants; the backfill fix's "mirror" claim exposes this pre-existing asymmetry

- **Where:** `apps/web/src/lib/image-queue.ts:375-379` vs `apps/web/src/lib/admin-backfill-runner.ts` (new `cleanupDeletedMidReencodeVariants`).
- **The seam:** commit `0017a34e` says the new backfill cleanup "mirrors the upload queue worker (image-queue.ts: affectedRows===0 → cleanup)." But the two are NOT mirrors:
  - **Upload worker** writes derivatives with admin-**configured** `imageSizes` (`image-queue.ts:342` → `processImageFormats(... imageSizes ...)`), but its delete-race cleanup calls `deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp)` with **no sizes arg → defaults to `DEFAULT_OUTPUT_SIZES`** (the hardcoded default, `process-image.ts:486`). No directory scan.
  - **Backfill** (correctly) passes `sizes=[]` → full directory scan → removes ALL `{name}_*{ext}` variants regardless of config.
- **Failure scenario:** admin configures non-default sizes (adds 3840px, or removes a default size). An upload races a concurrent delete of the same id. The upload worker's cleanup deletes only the `DEFAULT_OUTPUT_SIZES` filenames → the variants written at the *configured* sizes that aren't in the default list ORPHAN. Exactly the leak the backfill fix avoided. Admin-only, low-probability (concurrent delete during processing + non-default sizes), disk-leak only.
- **Honesty note:** the backfill fix is actually BETTER than what it claims to mirror — the commit message slightly overstates symmetry. The new code is correct; the worker it points at is the one with the latent leak.
- **Fix:** change `image-queue.ts:376-378` to pass `[]` as the third arg to all three `deleteImageVariants` calls, matching `deleteImage` (`images.ts:617-619`) and the new backfill cleanup — both of which already use `[]` for exactly this reason. One-line-per-format change; makes the worker a true mirror.

### CRT-3 (LOW, High) — `sanitize-for-og-global.test.ts` docstring overstates what THAT file pins ("C0-strip-locked"), though coverage exists in a sibling

- **Where:** `apps/web/src/__tests__/sanitize-for-og-global.test.ts:65` comment claims the JSON-LD page import assertion makes "the JSON-LD path C0-strip-locked."
- **The seam:** that file's `it.each` only asserts each consumer **imports** `sanitizeForOg from '@/lib/og-sanitize'` and does NOT call the old `.replace(UNICODE_FORMAT_CHARS` form. It does NOT itself assert any C0-strip behavior. The phrase "C0-strip-locked" is imprecise for THIS file in isolation.
- **Why it's only LOW (not a real gap):** the C0-strip behavior IS pinned — by the sibling `og-sanitize.test.ts:33-46` (`'a\x00b\x07c\x1F'` → C0 stripped, `\t\n\r` preserved). Together (import-pin + behavioral-C0 pin) the suite DOES lock "all three consumers get C0 stripping." So this is a comment-precision nit, not a coverage hole — the aggregate's AGG-R8c3-02 concern ("passes for the wrong reason") is genuinely closed across two files.
- **Fix:** soften the `:65` comment to "asserts the JSON-LD path consumes the shared helper; the C0-strip behavior itself is pinned in og-sanitize.test.ts" — so a future reader doesn't trust this one file to guard C0.

---

## VERIFIED-CLEAN (stress-tested this pass, NO action)

- **Backfill orphan-cleanup fix (`0017a34e`) — CORRECT across all interleavings.** I traced delete (`images.ts:538` — read row → tx delete imageTags+row → `deleteImageVariants(...,[])` ×3) against backfill `reprocessOne` (`processImageFormats` write → `UPDATE WHERE id` → `affectedRows===0` → cleanup). Every ordering resolves with no orphan: the cleanup runs after `processImageFormats` is fully awaited and after the UPDATE, so freshly-renamed files are always caught; concurrent double-unlink is ENOENT-safe (`fs.unlink(...).catch(()=>{})`). Root cause (deleteImage not holding the per-image lock) is mitigated by the affectedRows-cleanup rather than by serializing deletes behind backfills — the right tradeoff. The test (`admin-backfill-runner-deleted-mid-reencode.test.ts`) is non-vacuous: forces `affectedRows:0`, asserts cleanup fired on all 3 dirs with `sizes=[]`, and pins the counter partition (`deletedMidReencode=1`, processed/encodeFailures/detectionFailures/errors=0, `lastRunHadFailures=false`).
- **NCLX code-2 isHdr fix (`22387f32`) — doc+test only, no behavior change; comment is accurate.** The added `color-detection.ts` comment correctly documents the intentional upload-rejection side-effect and corrects the false "no delivered-byte impact" claim (which lived only in the immutable `74235265` commit msg). `images.ts:283` does gate upload rejection on `data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest` exactly as the comment states. Verified the upload gate path.
- **`text-destructive` → `text-destructive-text` migration (`77013cd0`) — complete and contrast-correct everywhere.** No remaining unmigrated `text-destructive` text sites (`grep` exit 1). Token defined in `:root` (line 43), `.dark` (69), `.oled` (97), + matching oklch fallbacks (130/139/147). **Computed actual WCAG ratios** (not trusting the docstring): light dt-on-white 6.47:1, dark dt-on-darkcard 7.19:1, oled 7.16:1 — AND on the tinted seams the aggregate didn't check: `bg-destructive/10` 5.54:1 light / 6.99:1 dark, `bg-destructive/5` 5.98:1 light / 7.10:1 dark. All clear 4.5:1 with margin. Docstring claims (5.9/7) are honestly conservative.
- **i18n localize fix (`6be638d2`) — correct namespace + key parity.** `retryFailedImage`'s `t` binds `getTranslations('serverActions')` (`images.ts:1078`), same as all 5 siblings; `invalidImageId` exists in both `en.json:504` and `ko.json:504`. No raw-key-render risk.
- **og-sanitize unification (`0028ede4`) — all three consumers (both OG image routes + JSON-LD page) import the shared `@/lib/og-sanitize`; no fourth copy.** `grep` of all `sanitizeForOg`/`stripUnicodeFormatting` sites confirms no surviving local copy. The HTML `<meta og:title>` in `generateMetadata` correctly does NOT use `sanitizeForOg` (Next.js HTML-escapes; validation layer rejects bidi/zero-width at write time; OG-sanitize is specifically for the Satori SVG renderer + JSON-LD defense-in-depth) — consistent, intentional asymmetry. JSON-LD's partial `sanitizeForOg` application (camera/lens/exposure sanitized; description/topic_label/keywords not) is pre-existing, non-exploitable (`safeJsonLd` escapes `</script>` + `<`; validation rejects at write), already covered by the aggregate.
- **migrate-coverage tripwire hardening (`6454c4a3`) — comment-strip is an honest improvement.** `stripJsComments` removes `//` and `/* */`; the docstring is HONEST that string literals are kept by design (real DDL names live in string literals), so the residual "name in a `console.warn` string satisfies the check" loophole is an acknowledged inherent limit of a text-presence check, not a regression.
- **SW bounded-HEAD test pin (`6454c4a3`) — non-vacuous; sw.js matches.** `sw-template-contract.test.ts` now asserts `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` within the HEAD-fetch options window in BOTH the template and generated `sw.js` (`public/sw.js:230`, `HEAD_REVALIDATE_TIMEOUT_MS=300` at `:38`). `git diff 9b7bb240 HEAD -- public/sw.js` is empty (template untouched this batch).
- **SW_VERSION stamp drift (informational, NOT a finding):** committed `sw.js` carries `SW_VERSION='ee0f38bd-p7'` while HEAD is `ce0029aa` — the stamp doesn't track HEAD in the repo. The `prebuild` hook (`package.json:10` → `build-sw.ts`) RE-STAMPS from git short-SHA on every deploy build, so production gets the correct `ce0029aa-p7`. The committed stale stamp is cosmetic-in-repo only; documented behavior.

---

## CROSS-AGENT CORRELATION

- **CRT-1 (audit regex false-positive)** is NEW — no other reviewer's narrow lens (designer checks visual contrast/sizes, test-engineer checks coverage presence) would catch an over-matching regex that's green today. This is the cycle's primary "next-layer adjacent gap" the fix batch introduced, directly analogous to how the cycle-3 critic caught the NCLX isHdr side-effect and the og-sanitize third copy.
- **CRT-2 (upload-worker cleanup asymmetry)** is adjacent to AGG-R8c3-03's fix — it's the seam the fix's own "mirror the upload worker" claim points at. A focused backfill reviewer would stop at "the backfill is now correct"; the cross-file lens reveals the worker it mirrors is the leaky one.
- The other 15 cycle-3 findings are CLOSED-and-behaving per independent re-verification — I found no "fixed on paper" item among them beyond the comment-precision nit (CRT-3).

## TOP CONCERNS (priority order)

1. **CRT-1 (MAJOR)** — fix the audit regex over-match before it bites a future `max-h-*` Button with a misleading CI failure. Cheap one-line regex anchor + 3 self-check assertions.
2. **CRT-2 (LOW)** — make the upload worker a true mirror (`sizes=[]`) to close its pre-existing non-default-size variant leak; aligns it with `deleteImage` and the new backfill cleanup.
3. **CRT-3 (LOW)** — soften one overstated test docstring; coverage is fine.
