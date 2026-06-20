# Code Reviewer — run-7 cycle-5

**HEAD:** `d38fa4a4` (working tree clean). Source is byte-identical to the converged cycle-4 HEAD; the only commits since cycle-4 are review docs + the SW_VERSION stamp.

**Verdict: 0 NEW actionable findings.** Truthful zero — convergence confirmed by direct code reading, not by silence.

## Method

1. Built a review-relevant inventory of `apps/web/src` (lib/, app/actions/, app/api/**/route, db/schema) ranked by size/risk.
2. Fanned out 6 parallel skeptical sub-reviews across independent functional clusters (rate-limiting, stripe/checkout/download money path, color binary parsers, GPS strip, data-access/privacy, queue/backfill concurrency).
3. **Did NOT trust sub-reviewer conclusions.** Independently re-read and adjudicated every lead they surfaced against the actual code, plus did my own deep-dive on surfaces they did not touch (OG SSRF, similar-search, serve-upload path containment, request-origin, validation, base56, exif-datetime, use-display-capability React-snapshot hazard).

## Sub-reviewer leads — all adjudicated as NON-bugs

| Lead | Rated | Adjudication |
|---|---|---|
| `bounded-map.ts:116` `>` vs `>=` eviction | self-downgraded | NOT A BUG. Design allows growth to cap, evicts on next `prune()`; callers prune before insert. Confirmed. |
| `rate-limit.ts:145` login "allows 4 not 5" | MODERATE | **REFUTED.** Traced `auth.ts:105-159`: in-memory gate is PRE-increment (`count >= 5` sees count=4 on the 5th attempt → passes), DB re-check is POST-increment (`count > 5`). Exactly 5 attempts allowed, 6th blocked. Matches spec. |
| `rate-limit.ts:240/285/307` window-reset `<=` | self-refuted | NOT A BUG. `resetAt <= now` is correct exclusive-end window semantics. |
| `auth-rate-limit.ts:24/34` reset count not lastAttempt | code smell | NOT A BUG. In-memory entries are a fast-path fallback; DB bucket is source of truth; callers write back. |
| `upload-tracker-state.ts:63` `>` boundary | self-refuted | NOT A BUG. Consistent exclusive-end semantics codebase-wide; 1 ms grace on a 1 h window is immaterial. |
| stripe/checkout/download (10 vectors) | 0 found | **Independently re-verified the money path.** payment_status gate precedes all work (`webhook:105`); idempotency = SELECT-by-sessionId (`:320`) + ON DUP KEY + `affectedRows===1 && insertId>0` disambiguation (`:382`); download token uses `timingSafeEqual`; entitlement lookup requires (imageId AND tokenHash); price is server-only; zero-amount rejected (`:299`). Clean. |
| `icc-extractor.ts:99` "mluc length is chars not bytes" | HIGH | **REFUTED.** Per ICC.1:2010 §10.13 the mluc record `length` field (offset+4) is in BYTES, not characters. Code is correct. The HIGH rating was wrong. |
| `icc-extractor.ts:101` "offset semantically backwards" | MEDIUM | **REFUTED.** The mluc record `offset` field is relative to the start of the tag data (`dataOffset` here) per spec; `strStart = dataOffset + recTextOffset` is correct. |
| `color-detection.ts:239` box-size-0 infinite loop | MEDIUM-HIGH | **REFUTED.** Loop body runs only when `pos+8 <= limit <= buffer.length`, so `size = buffer.length - pos >= 8`; `boxEnd = buffer.length`; `pos` jumps to EOF; loop exits. `size` 1-7 → break. No stall possible. |
| `icc-chromaticity.ts:247` loose initial validation | LOW | NOT A BUG. Layered per-read bounds checks (`readS15Fixed16` validates `offset+4`). Defense-in-depth, not a defect. |
| gps-exif-strip (6 vectors) | 0 found | Robust: per-read `inBounds`, complete GPS neutralization across JPEG/TIFF/HEIF/AVIF/WebP incl. extended-XMP rejoin + IFD1 thumbnail + offset-referenced MakerNote, single endianness reader, IFD cycle-detection (`visited` set), correct absolute-offset `buf.fill`, fail-safe `null`→re-encode. |
| data.ts privacy (6 vectors) | 0 found | All public queries use `publicSelectFields`/`timelineSelectFields`/`publicMapSelectFields`; compile guards (`_PrivacySensitiveKeys`) present; all 8 GROUP_CONCAT queries have `GROUP BY images.id`; cursor uses strict `lt` (no boundary dup); cache wrappers keyed on public-only args. |
| image-queue/backfill (6 vectors) | 3 "edge cases" | All are DOCUMENTED best-effort or non-correctness: advisory locks are try/finally-paired on dedicated connections; SIGTERM in-flight commit loss is the documented best-effort contract; `running` flag is UI-only (advisory lock is the authority). No new bug. |

## Surfaces I deep-dived directly (beyond sub-reviewers) — all clean

- **`og/photo/[id]/route.tsx` + `og-photo-fetch.ts`** — SSRF defense correctly pins fetch origin to trusted `siteConfig.url` (not `req.url`); per-attempt 10 s timeout + 1 MB cap; charged-vs-refunded rate-limit policy correct (rollback only pre-DB syntactic rejects).
- **`serve-upload.ts`** — SAFE_SEGMENT regex + `.`/`..` reject + `lstat` symlink reject + `realpath` containment with `${resolvedRoot}${path.sep}` prefix (avoids `/root` vs `/root-evil` confusion) + streams from resolved path (TOCTOU closed). ETag delegates key list to `COLOR_IMPACTING_KEYS` (no inline drift).
- **`request-origin.ts`** — fails closed (no Origin/Referer → false unless explicitly opted in); strips default ports; trusted-proxy hop selection correct.
- **`search/similar/[id]/route.ts`** — gate ordering correct; rollback on every pre-work early return; production-only gate; self-exclusion in scoring.
- **`validation.ts`** — `safeInsertId` BigInt overflow guard; `countCodePoints` length checks match utf8mb4; `UNICODE_FORMAT_CHARS` escape-sequence form; `stripUnicodeFormatting` derived (not hand-copied) global twin.
- **`base56.ts`** — correct rejection sampling (reject ≥224 = 4×56, unbiased `%56`); pool refill; 1000-attempt failsafe.
- **`exif-datetime.ts`** — `Date.UTC` round-trip rejects Feb-30-style overflow.
- **`use-display-capability.ts`** — snapshot memoization returns stable reference until gamut/isHdr flips (no React #185 loop); stable `getServerSnapshot`; symmetric subscribe cleanup.

## Already-adjudicated items — confirmed NOT re-raised

MED-R7C2-01 (histogram clip %), REJ-R7C3-01 (indexSize), DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01. None re-filed; no new decisive evidence found to reopen any.

## Conclusion

A genuine whole-repo correctness pass over the highest-risk surfaces (money path, GPS-to-paying-customers, binary parsers, rate limits, privacy, path containment, client state) produced **zero new actionable findings**. Every parallel-agent lead was either self-refuted or refuted by direct code reading against spec. This is the expected convergence outcome for a 4-cycle-stable, byte-identical HEAD — reported truthfully rather than padded with cosmetic churn.
