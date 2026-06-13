# Document Specialist — Cycle 3 DOC↔CODE Mismatch Review

**Scope:** Verify the most concrete/checkable doc claims (CLAUDE.md, AGENTS.md, code comments) against code at HEAD `ada92ba5`.
**Method:** grep + read of source-of-truth files; ran full vitest suite for the test-count claim. Verified prior-cycle-CLOSED items (AGG-R8-11 deploy/test-count, AGG-R8-12 advisory-lock docblock) did NOT regress.

## Verdict

The repo's load-bearing docs are in excellent shape — the prior cycles' doc-honesty work held. **All numeric/identifier claims I checked are accurate.** No hard mismatches (no claim where the doc says X and the code does NOT-X). The genuine findings are **doc-INCOMPLETENESS gaps**: three behaviors landed by this cycle's predecessor commits (the run-8-c2 AGG-R8-* batch) are not yet reflected in CLAUDE.md's prose. These are additive omissions, not falsehoods, so severity is LOW — but they should be folded in to keep the docs as the reliable index they're relied on to be.

---

## FINDINGS

### DOC-1 — CLAUDE.md SW section omits the bounded HEAD-probe (AGG-R8-05). LOW. confidence High.

**Doc claim** (`CLAUDE.md:294`, Service Worker section):
> **Image derivatives**: stale-while-revalidate with an ETag HEAD probe, 50 MB LRU cap.

**Code reality** (`apps/web/public/sw.template.js:34-38, 213-230`): the synchronous HEAD ETag probe is now **bounded** by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` where `HEAD_REVALIDATE_TIMEOUT_MS = 300` (AGG-R8-05, run-8 c2). The in-code comment explains the rationale: an unbounded HEAD would stall each masonry tile one RTT (or until the default fetch timeout on a hung network) before stale-serve.

**Mismatch:** The doc describes the HEAD probe but not that it is time-bounded at 300 ms — a meaningful operational/perf detail added this cycle. Not wrong, just stale-by-omission.
**Fix (doc side):** Append to the bullet, e.g. "…ETag HEAD probe (bounded to a 300 ms `AbortSignal.timeout`, AGG-R8-05, so a slow/hung network stale-serves instead of stalling each tile), 50 MB LRU cap."

---

### DOC-2 — CLAUDE.md touch-target "Pattern coverage" list omits the raw `<input type="checkbox|radio">` scanner (AGG-R8-03). LOW. confidence High.

**Doc claim** (`CLAUDE.md:520-528`, Touch-Target Audit → Pattern coverage): the FORBIDDEN-pattern bullet list enumerates the classes the scanner catches and ends at native `<select>` (R4C16). The "Multi-line tags" paragraph (`CLAUDE.md:530`) lists the normalized tag set as `<Button>` / `<button>` / `<Badge>` / native `<select>`.

**Code reality** (`apps/web/src/__tests__/touch-target-audit.test.ts:598-634`): a `scanRawCheckboxes()` pass (AGG-R8-03, run-8 c2) now flags raw `<input type="checkbox">` / `type="radio"` that lack a ≥44 px tap area on the input itself or a wrapping `min-h-11 min-w-11 <label>`. It has its own windowed multi-line scan and a dedicated fixture test (`:839`). `components/ui/checkbox.tsx` is in `KNOWN_VIOLATIONS` at 0 (`:129`).

**Mismatch:** The audit now catches a 5th pattern class (raw checkboxes/radios) that the CLAUDE.md coverage list and multi-line-normalization list do not mention.
**Fix (doc side):** Add a bullet to "Pattern coverage" (raw `<input type="checkbox|radio">` without a ≥44 px self/label tap area — AGG-R8-03) and note the windowed checkbox scan in the "Multi-line tags" paragraph.

---

### DOC-3 — CLAUDE.md Security/SEO section omits the runtime OG-route sanitizer `og-sanitize.ts` / `sanitizeForOg` (AGG-R8-13). LOW. confidence High.

**Doc claim** (`CLAUDE.md:178`, Database Security → Privacy/validation): describes Trojan-Source bidi/zero-width defense only at the **validation layer** (`UNICODE_FORMAT_CHARS` / `containsUnicodeFormatting` in `validation.ts`), listing "OG images, SEO `<title>` / `<meta description>` / `<meta og:*>`" among the protected surfaces.

**Code reality** (`apps/web/src/lib/og-sanitize.ts` — new file, AGG-R8-13; imported by `apps/web/src/app/api/og/route.tsx:5` and `apps/web/src/app/api/og/photo/[id]/route.tsx:8`): a shared `sanitizeForOg()` now applies a **defense-in-depth runtime strip** at the Satori OG-render routes, using `stripUnicodeFormatting` (the GLOBAL-flag twin — strips ALL bidi/zero-width chars, not just the first; consistent with HEAD commit `170297ed` "strip ALL bidi chars in OG/JSON-LD, not just the first") plus a C0-control strip. Previously the home/site OG route rendered `siteTitle`/`topicLabel`/tags RAW while the per-photo route had a local sanitizer — AGG-R8-13 closed that symmetry gap by extracting one module.

**Mismatch:** CLAUDE.md presents the validation layer as the OG protection but doesn't mention the second runtime layer (`og-sanitize.ts`) added this cycle. The doc isn't wrong (validation-layer defense is real) but is now incomplete on a security-relevant surface.
**Fix (doc side):** Add a line under the Privacy/validation bullet or the SW/SEO area noting that `apps/web/src/lib/og-sanitize.ts` (`sanitizeForOg`, AGG-R8-13) provides a derive-don't-copy runtime defense-in-depth strip at both `api/og/route.tsx` and `api/og/photo/[id]/route.tsx`, using the global-flag `stripUnicodeFormatting` so a loosened validator can't let bidi reach one OG card while the other strips it.

---

### DOC-4 — CLAUDE.md home-page `og:image` now points at `/api/og/photo/${id}` (AGG-R8-02); not documented. LOW (informational). confidence High.

**Code reality** (`apps/web/src/app/[locale]/(public)/page.tsx:98-114`): per comment AGG-R8-02 (run-8 c2), the home OG `<meta og:image>` now points at the per-photo OG ROUTE (`/api/og/photo/${latestImage.id}`) — the same card the `/p/[id]` pages use — rather than a static/derivative image URL.

**Doc claim:** CLAUDE.md has **no** mention of `/api/og` or the home-page OG-image source (grep for `api/og` / `og:image` in CLAUDE.md returns nothing). The SEO/OG behavior is undocumented in the knowledge base.

**Mismatch:** Not a contradiction (the doc is silent), but given how detailed CLAUDE.md is elsewhere, the OG-image route architecture (per-photo Satori cards at `/api/og/photo/[id]` and site cards at `/api/og`, both bidi-sanitized) is a notable gap. Bundle the fix with DOC-3.
**Fix (doc side):** One sentence documenting the OG-card routes and that the home OG image reuses the latest-photo card via `/api/og/photo/[id]`.

---

## VERIFIED-ACCURATE (checked, NO mismatch — recorded so the next cycle doesn't re-walk them)

| Claim | Doc location | Code source-of-truth | Result |
|---|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | CLAUDE.md:99, 137 | `gallery-config-shared.ts:21` (`= 7`), re-exported `process-image.ts:303` | ✅ matches |
| `COLOR_IMPACTING_KEYS` count = **9** (5 color + 3 quality + image_sizes) | CLAUDE.md:260 | `settings-hash.ts:34-46` (9 keys; docstring also says 9, AGG-R7-08) | ✅ matches — the prompt's "says 5 in one place" concern is ALREADY corrected; no stale "5" remains. NOTE for record: line 260 prose still uses "the 5 color keys … the 3 quality keys … and image_sizes" as a *breakdown* of the 9 — that is correct, not a contradiction. |
| Settings hash is 8 chars, no `.slice(0,8)` at ETag site | CLAUDE.md:260 | `settings-hash.ts` `HASH_LENGTH = 8`; serve-upload uses it directly | ✅ matches |
| Default image sizes `[640,1536,2048,4096,5120,7680]`; 8-size cap | CLAUDE.md (pipeline §) | `gallery-config-shared.ts:90` (DEFAULT_IMAGE_SIZE_VALUES), `:137` `MAX_IMAGE_SIZE_COUNT = 8`, `:247` enforce | ✅ matches |
| Argon2id memoryCost 65536 / timeCost 3 / parallelism 4 | CLAUDE.md (Security §) | `password-hashing.ts:11-14` | ✅ matches |
| Login rate limit 5 attempts / 15-min window, per-IP + per-account buckets | CLAUDE.md (Auth §) | `rate-limit.ts:62-63` (`15*60*1000`, `=5`); `auth-rate-limit.ts:19,47` (`login` + `login_account` keys, same window) | ✅ matches |
| Pool 10 connections / queue limit 20 / keepalive | CLAUDE.md (Indexes §) | `db/index.ts:23` `POOL_CONNECTION_LIMIT = 10`, `:33` `queueLimit: 20`, `:35` `enableKeepAlive: true` | ✅ matches |
| nginx caps: 2 MiB default / 64 KiB login / 250 MiB db / 216 MiB upload | CLAUDE.md (Important Notes) | `nginx/default.conf:31,58,75,92` (`2M`/`64K`/`250M`/`216M`) | ✅ matches |
| App caps: 200 MiB/file, 2 GiB window, 100 files/window | CLAUDE.md (Important Notes) | `upload-limits.ts:1-3` (`2 GiB`, `100`, `200 MiB`); `images.ts:158,652,882` enforce | ✅ matches |
| Advisory-lock name list (6 names) | CLAUDE.md (Race §) | `advisory-locks.ts:19,22,25,34,41,44` — all 6 strings match exactly | ✅ matches (AGG-R8-12 docblock present `:8-16`, not regressed) |
| `MAX_BLUR_DATA_URL_LENGTH = 4096` (~3 KB) | CLAUDE.md (pipeline §) | `blur-data-url.ts:45` (`= 4096`), `:49` enforce | ✅ matches |
| Blur producer-side wrap via `assertBlurDataUrl` (AGG4-L01) + 2 fixture tests | CLAUDE.md (pipeline §) | `process-image.ts:17,883`; `__tests__/process-image-blur-wiring.test.ts` + `images-action-blur-wiring.test.ts` exist | ✅ matches |
| `useDisplayCapability` Firefox ≤109 → 'srgb', 110+ uses MQ, screen.colorGamut unsupported all FF | CLAUDE.md (browser matrix) | `use-display-capability.ts:6-9, 52-66`; getSnapshot memoization `:41-80` (React #185) | ✅ matches |
| Encoder decision enum values (`srgb`, `srgb-from-unknown`, `p3-from-{displayp3,dcip3,adobergb,prophoto,rec2020}`) | CLAUDE.md decision matrix | `color-pipeline-decisions.ts:23-29` | ✅ matches |
| `avif_effort` default 6 (Sharp native default 4) | CLAUDE.md (tunables) | `gallery-config-shared.ts:128` (`'6'`), `:194` (0–9 validator) | ✅ matches |
| Migration runbook fn names (`getAllJournalMigrations`, `reconcileLegacySchema`, `baselineAllJournalMigrations`, `prepareLegacyDatabaseIfNeeded`, `every(hash)` check, "Drizzle silently skipped N" post-condition) | CLAUDE.md (Migration runbook) | `migrate.js:144,156,247,642,659,683,713,750,759` | ✅ matches |
| Two backfill entry points persist SAME column set + no-version-bump on detection failure | CLAUDE.md (Backfill §) | `admin-backfill-runner.ts:528-537` (full column set incl. `was_downscaled`,`avif_10bit`), `:544-548` (no bump on detection failure) | ✅ matches |
| i18n plural convention: EN ICU plural, KO single fixed form, no `plural` block in ko | CLAUDE.md (DOC-R5C3-07) | `messages/en.json:162,407,825` (ICU); `messages/ko.json` — zero `plural` occurrences, `{count}장`/`{count}개` | ✅ matches |
| Stripe `checkout.session.async_payment_succeeded` NOT yet handled (until plan-316 CRT-R5C1-04) | CLAUDE.md:120 | `stripe/webhook/route.ts:88-117` — only `checkout.session.completed`, gates on `payment_status==='paid'`, rejects `'unpaid'`; explicit comment "Async-paid flows are not currently supported" | ✅ ACCURATE (warning is correct, NOT stale) |
| `hdr-filenames.ts` RESERVED / NOT WIRED until WI-09 | CLAUDE.md:100 | zero non-test importers of `hdr-filenames` | ✅ matches |
| `uploaded_by` FK `ON DELETE SET NULL` + `idx_images_uploaded_by` | CLAUDE.md schema table | `schema.ts:94` (`onDelete:'set null'`), `:118` index | ✅ matches |
| `tagNamesAgg` = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` shared across lite queries | CLAUDE.md (Perf §) | `data.ts:605`, used `:734,783,833,866` | ✅ matches |
| `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guard | CLAUDE.md (Privacy §) | `data.ts:417-419` | ✅ matches |
| **AGENTS.md "Vitest 2000+ unit tests"** | AGENTS.md:36 | **Ran full suite: 213 files, 2060 tests passed.** | ✅ ACCURATE (the grep-of-`it(`/`test(` undercounts to 1916 because of `it.each`/`test.each` parameterization; runtime count is 2060 > 2000) |
| AGENTS.md deploy mechanism (`npm run deploy`, config-driven `.env.deploy`, no hardcoded host) | AGENTS.md:17-18 | `package.json:21` `"deploy": "./scripts/deploy-remote.sh"`; AGENTS.md references `.env.deploy` not literals | ✅ matches (AGG-R8-11 deploy-key drift fix not regressed) |
| NCLX code-2 ("Unspecified") per-field fallthrough to ICC (AGG-R8-06) | CLAUDE.md precedence "NCLX > ICC chromaticity > ICC name" | `color-detection.ts:370-388` applies each NCLX field only when `!== undefined`, keeping ICC value otherwise | ✅ consistent — the doc's per-field precedence wording matches the per-FIELD code behavior; no contradiction |

---

## Notes for orchestrator

- **No HIGH/MED doc mismatches.** Every numeric, identifier, enum, FK, lock-name, and runbook-function claim I checked is correct against HEAD. The prior cycles' doc-honesty discipline is holding.
- The four LOW findings (DOC-1..4) all trace to ONE root cause: the run-8-c2 AGG-R8-* commit batch (bounded SW HEAD, raw-checkbox scanner, og-sanitize extraction, home OG route) landed CODE + in-code comments but the CLAUDE.md prose index wasn't updated in lockstep. A single small doc patch closes all four.
- I deliberately ran the full vitest suite (294 s) rather than trust a grep, because the "2000+" test-count claim is exactly the kind of number that drifts — confirming it's accurate (2060) avoided a false-positive finding.
