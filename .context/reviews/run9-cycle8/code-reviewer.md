# Code Reviewer — Run-9 Cycle-8 (HEAD 4e132b03)

Angle: correctness / logic / data-flow / error-handling / invariants. Every candidate validated against the
actual code, not comments. Method: 7 parallel deep-audit agents over the whole `apps/web/src/` surface +
personal verification of every substantive candidate + targeted commonly-missed sweeps + typecheck gate.

## Code Review Summary

**Coverage (whole-repo inventory, not a sample):**
- **auth/session/rate-limit** — session.ts, password-hashing.ts, auth-rate-limit.ts, rate-limit.ts, bounded-map.ts, actions/auth.ts, actions/admin-users.ts, api-auth.ts, action-guards.ts, request-origin.ts, proxy.ts
- **data/privacy** — data.ts (1660 L), data-timeline.ts, smart-collections.ts, analytics-data.ts, atom-feed.ts, db/schema.ts
- **color/HDR** — color-detection.ts, icc-chromaticity.ts, icc-extractor.ts, gain-map-detection.ts, color-primaries.ts, color-pipeline-decisions.ts, settings-hash.ts
- **process-image/upload** — process-image.ts (1650 L), process-topic-image.ts, upload-paths/filenames/limits/tracker(-state).ts, gps-exif-strip.ts, blur-data-url.ts
- **server-action mutations** — actions/images.ts (1160 L), topics.ts, tags.ts, sharing.ts, collections.ts, settings.ts, seo.ts, embeddings.ts, validation.ts
- **queue/shutdown/backfill/restore** — image-queue.ts (806 L), queue-shutdown.ts, admin-backfill-runner.ts, view-retention.ts, db-restore.ts, restore-maintenance.ts, sql-restore-scan.ts, admin/db-actions.ts, advisory-locks.ts
- **serving/cache/SW/client-hooks** — serve-upload.ts, use-display-capability.ts, sw-cache.ts, sw.template.js, image-url.ts, image-zoom-math.ts, revalidation.ts, feed-conditional.ts, og-photo-fetch.ts, og-sanitize.ts, safe-json-ld.ts
- **sweeps** — settings-forwarding regression check (c7 fix), parseInt-radix, JSON.parse guards, smart-collection SQL compiler.

**Total findings:** 0 DEFECT, 1 POLISH (Low).

### By Severity
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 1 (POLISH — un-`t()`'d admin error string)

---

## Regression check — the c7 settings-forwarding fix landed correctly

`api/admin/lr/upload/route.ts:420-444` now forwards all 6 admin processing settings
(`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
`wideGamutMaxSourcePixels`, `autoAltTextEnabled`) from the already-loaded `config`, mirroring the
browser fix at `actions/images.ts`. The image-queue gate (`image-queue.ts:336` `!quality && !imageSizes`)
and pre-gate seeds (326-335) are consistent. **The settings-forwarding defect class (c5/c6/c7) is
CONFIRMED EXHAUSTED** — all 3 consumer enqueue paths (browser, LR, retry→config-load) and the 3 internal
re-enqueues (claim-retry 290, error-retry 510, bootstrap 674) are correct. No new instance found.

---

## Candidate findings raised by sub-agents — adjudicated FALSE POSITIVE / POLISH

I treat sub-agent output as candidates, not conclusions. Each substantive candidate was verified against
the actual code; all resolved as below. This is the expected outcome for a converged system and is recorded
here so the next cycle does not re-litigate them.

### FP-1 — "Missing rate-limit rollback on DB-check exception" (auth.ts:362, admin-users.ts:127) — REFUTED
**Claim:** when `checkRateLimit()` throws (transient DB error) on the password-change / user-create path,
the pre-incremented counter is "stranded" and the user "permanently loses one attempt"; proposed fix = add
rollback in the catch.
**Why it is NOT a defect (verified at auth.ts:340-364, 124-164):** The pre-increment is the *intended*
TOCTOU fix — a failed-auth attempt SHOULD consume budget even if downstream work happens; the in-memory Map
increment standing on a DB blip is correct (the catch comment "rely on in-memory Map" is accurate). The
proposed "fix" would be a **security regression**: an attacker who can induce DB errors would get free
attempts refunded. The login path's catch (157-164) only rolls back when *already over limit* (to emit the
throttle error), NOT to refund the attempt — so the password-change/user-create catch behavior is the
correct symmetric semantics, not an omission. Fast-path caps (340 / 120) already reject at-limit before the
increment. No defect.

### FP-2 — "Off-by-one in WI-15 wide-gamut downscale cap" (process-image.ts:1022-1042) — REFUTED
**Claim:** a 50.08 MP source downscales to "50.04 MP, still above the 50 MP cap," risking OOM.
**Why it is NOT a defect (verified at 1022-1042):** `scale = sqrt(CAP/basePixels)`, and resize sets WIDTH
only with Sharp scaling height proportionally, so output pixels ≈ `basePixels · scale² = CAP` by
construction. The only error is integer rounding of a single dimension (`Math.round(baseWidth·scale)`),
~10⁻³ % — a few hundred pixels, not 43,312. The agent's own arithmetic was internally inconsistent (applied
scale to width but not height). The 50 MP cap is a heuristic OOM guard with huge headroom (rgb16 ≈ 6 B/px →
~300 MB at 50 MP); a 0.001 % overshoot adds ~3 KB. There is no heap where 50.000 MP succeeds but 50.04 MP
OOMs. No defect; not even a justified polish.

### FP-3 — "Advisory-lock leak on error path in acquireImageProcessingClaim" (image-queue.ts:207-224) — REFUTED
**Claim:** if the `GET_LOCK` query throws after MySQL acquired the lock server-side, `lockConnection.release()`
returns the connection to the pool with the lock still held → future deadlock.
**Why it is NOT a defect (verified 207-224 + the identical pattern at admin-backfill-runner.ts:304-319/344-357):**
For `SELECT GET_LOCK(?,0)` — a trivial 1-row query — the only realistic way the server acquires the lock but
the client throws is a *connection-level* error (socket drop / protocol error). mysql2 marks such a
connection fatally errored and **destroys it on `release()` rather than returning it to the pool**; closing
the MySQL session **auto-releases all session-held advisory locks**. There is no application-level code
between the `await` resolving and the `return` that could throw non-fatally (`rows[0]?.acquired === 1` uses
optional chaining and cannot throw). So the leak window the agent describes is unreachable. The same
acquire-in-try / release-in-catch / re-throw shape is used in two other lock helpers and has survived 9
review runs — it is the codebase's deliberate, correct idiom, not an oversight. No defect.

### FP-4 — "Topic slug-rename TOCTOU" (topics.ts:247-286) — REFUTED
Serialized by the `LOCK_TOPIC_ROUTE_SEGMENTS` advisory lock (imported topics.ts:35, documented in CLAUDE.md
Race-Condition section). The concurrent-upload interleave the agent describes cannot occur while the lock is
held. No defect.

### FP-5 / FP-6 — "settings.ts strip_gps TOCTOU" / "embeddings.ts missing await" — REFUTED
settings.ts gap is the documented, by-design "setting does not apply retroactively" limitation (the action
comment states it; the upload-processing-contract advisory lock fences the once-photos-exist case).
embeddings.ts:142-153 inserts are correctly `await`ed inside the Promise.all. No defects (the agents
themselves retracted both on re-inspection).

---

## Broad sweep — independently confirmed sound (no new DEFECT)

- **Privacy field filtering (data.ts):** `publicSelectFields` / `publicMapSelectFields` omit all
  `_PrivacySensitiveKeys`; map variant retains only lat/long deliberately; compile-time `_SensitiveKeysInPublic`
  guard + runtime GPS-leak assertion (≈1594). `tagNamesAgg` is the GROUP_CONCAT aggregate (not the prod-broken
  correlated subquery), every consumer pairs it with `groupBy(images.id)`. avif_10bit intentionally public-safe.
- **Color/HDR (all 7 files):** ISOBMFF/HEIF walkers bound depth(5)/scan(1 MB)/box-size-vs-buffer; NCLX
  primaries/transfer/matrix maps correct (incl. adjudicated code 5→gamma28, code 8→ycgco); ICC desc/mluc tag
  parsing bounds offset+len vs both buffer and tag end, locale-matched; XYZ→xy guards sum<1e-9; ΔE thresholds
  0.005/0.015; `COLOR_IMPACTING_KEYS` covers all 9 byte-impacting keys with a compile-time key-validity guard.
- **process-image / upload:** per-format fresh `sharp()` (WI-14, intentional), partial-write cleanup via
  `writtenSizedPaths` sets + finally tmp-unlink, atomic link/copy fallback, autoOrient-consistent MP gate,
  10-bit AVIF probe fallback. GPS strip: lossless byte-level neutralization with metadata-free re-encode
  fallback; never `withMetadata()`. blur-data-url MIME+length contract enforced producer+writer+reader.
- **server-action mutations:** every mutating export stores `requireSameOriginAdmin()` and returns early;
  `isAdmin()` defense-in-depth; integer-id guards (`Number.isInteger && >0`); batch deletes transactional
  (imageTags+images atomic); last-admin delete fenced by `LOCK_ADMIN_DELETE`; persisted admin strings routed
  through `containsUnicodeFormatting`; revalidation after visible-data mutations.
- **queue/shutdown/backfill/restore:** claim via non-blocking GET_LOCK + `WHERE processed=false` conditional
  UPDATE + release-in-finally; backfill version-bump invariant correct (signals branch bumps, no-signals
  branch does NOT — preserves retry-on-detection-failure); delete-mid-reencode cleanup `deleteImageVariants(…,[])`
  full-scan on affectedRows===0 in all 3 paths; view-retention chunked DELETE terminates (`affected<BATCH` or
  MAX_BATCHES) with future-cutoff guard; sql-restore-scan handles conditional-comment / masked-DROP /
  chunk-straddle (prev-1 MB-tail + chunk); restore lock RELEASE on every error path.
- **serving/cache/SW/hooks:** serve-upload ETag `W/"v{ver}-{mtime}-{size}-{hash8}"`, realpath TOCTOU guard +
  `root+sep` containment, RFC-7232 If-None-Match (list + `*`), abort-safe stream destroy; SW LRU
  insertion-order eviction + 300 ms HEAD-revalidate abort + admin-render `x-gk-admin-render` exclusion;
  `useDisplayCapability` snapshot value-memoized (React #185 safe), MQ listeners + focus/visibility cleaned up,
  constant `getServerSnapshot`; og-sanitize strips bidi/zero-width(global) + C0; safe-json-ld escapes
  `<`/U+2028/U+2029.
- **smart-collection SQL compiler:** column allowlist, all values via Drizzle parameterized ops (no string
  concat), LIKE-escaped, IN bounded by MAX_IN_VALUES, per-column operator narrowing, exhaustive-switch throw.
- **JSON.parse sites (3):** admin-tokens.ts:120, smart-collections.ts:310, api/search/semantic:168 — all
  try/catch-guarded; parseInt sweep: no missing-radix calls.
- **Typecheck gate:** `npm run typecheck` (app + scripts) passes clean — zero type errors across the surface.

---

### POL-R9C8-01 — un-localized admin error string in retryFailedImage  [POLISH, confidence: Low]
`apps/web/src/app/actions/images.ts:1122` returns `{ error: 'Image not found or not in a failed state' }`
as a hardcoded English literal, while every sibling error in the same action uses `t(...)`. Admin-only,
cosmetic; a non-English admin retrying a non-failed/missing image sees English. Not a correctness, security,
or data issue — pure i18n consistency. Fix: add a message key (e.g. `imageNotFoundOrNotFailed`) to
`en.json`/`ko.json` and return `t('imageNotFoundOrNotFailed')`. Flagged for completeness; non-blocking and
explicitly NOT counted as a defect.

---

## Open Questions
None at actionable confidence. No low-confidence CRITICAL/HIGH findings to surface — every candidate that
sounded HIGH (rate-limit rollback, lock leak, downscale OOM) was decisively refuted against the code.

## Positive Observations
- The settings-forwarding fix series (c5→c7) converged cleanly: the pre-gate seeding in image-queue.ts makes
  the handler tolerant of any job shape, so the regression's blast radius was "defaults" not "crash," and the
  c7 LR fix now achieves browser/LR encode parity.
- Advisory-lock discipline is uniform: a single registry (`advisory-locks.ts`), non-blocking acquire,
  release-in-finally, and connection-destroy-on-fatal-error semantics that make the acquire idiom safe even
  on the error path that an agent (wrongly) flagged.
- Defense-in-depth is layered, not single-point: privacy (compile-time guard + derived select objects +
  runtime GPS assertion), SQL-restore scan (conditional-comment + masked-DROP + chunk-straddle), Unicode
  (validator + OG runtime sanitizer + JSON-LD escape).

## Recommendation
**APPROVE** — No CRITICAL/HIGH/MEDIUM defects at any confidence. The settings-forwarding class is confirmed
exhausted, the c7 fix is correct, and every newly-surfaced candidate (rate-limit rollback, lock-release-gap,
WI-15 downscale, topic TOCTOU) resolved to FALSE POSITIVE under verification. One Low-confidence POLISH item
(un-`t()`'d admin string) noted, non-blocking. This is the expected steady state of a converged system.

## DISPOSITION: 0 DEFECTS, 1 POLISH item.
