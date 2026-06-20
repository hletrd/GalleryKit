# Code Reviewer — run-7 cycle-6 deep review

**Reviewer angle:** code-reviewer (logic bugs, edge cases, race conditions, error handling, invariant/data-flow correctness)
**Repo HEAD:** 1463f219 (SW stamp only); source tree byte-identical to converged cycle-5 source HEAD e855e6ee
**Source diff sanity:** `git diff e855e6ee..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` is EMPTY (verified).

## Verdict

**0 new actionable findings — truthful zero.**

This is the expected and correct outcome. The source tree under review is unchanged from the converged cycle-5 state. Cycles 1–5 of run-7 exhausted the genuine finding surface (matrix code 8→YCgCo, transfer 5→gamma28, matrix=1 pin, matrix 0/9 pins). I performed a genuine fresh skeptical pass from the code-reviewer angle anyway — reading the code, not the comments — across the full money path, every color binary parser, the privacy layer, the queue/backfill machinery, and the auth/rate-limit surface. I found no logic bug, missed edge case, race, error-handling gap, or invariant violation that is not already correctly handled.

I did **not** manufacture cosmetic churn, speculative refactors, or "nice to have" test additions to look productive.

## Evidence gathered (objective gates)

- **Typecheck:** `npm run typecheck --workspace=apps/web` → exit 0. All compile-time privacy guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`, `_ColorKeysAreSettingKeys`) compile clean.
- **Unit tests (158 total, 0 failures):**
  - Binary parsers: color-detection / icc-chromaticity / gain-map-detection — 75 passed.
  - Money path + privacy + queue + rate-limit + backfill: checkout-route, checkout-db-error-rollback, stripe-webhook-source, privacy-fields, map-privacy, view-retention, auth-rate-limit (+ordering/+rollback), admin-backfill-runner-detection-failure, backfill-color-pipeline, image-queue — 83 passed.

## What I verified CLEAN (per file, with the specific concern I checked)

### Money path
- **`app/api/stripe/webhook/route.ts`** — Guard ordering is sound: `payment_status==='paid'` (L105) → email shape/length (L153,185) → required-metadata (L193) → tier allowlist (L231) → imageId parse (L238) → deleted-image check (L273) → zero-amount (L299) → idempotency SELECT (L320) → insert. No goods-given-no-money (paid gate before entitlement) and no money-taken-no-goods (card-only pin in checkout makes completed+unpaid unreachable). Idempotency is double-guarded (SELECT + `onDuplicateKeyUpdate` with the verified `affectedRows===1 && insertId>0` fresh-insert disambiguation, L382). Deleted-image FK race handled both pre-insert (L273) and in-catch via `ER_NO_REFERENCED_ROW_2` (L390), both returning 200 to stop Stripe retry. Email truncation reject-before-slice (L153) closes the silent-mailbox-substitution hole.
- **`app/api/checkout/[imageId]/route.ts`** — Pattern-2 rollback on every early return (L92,112,116,120,128,133,241). Strict `^\d+$` price parse (L63). Code-point-safe title truncation (L158, avoids surrogate-pair bisection). Idempotency key correctly OMITTED for `ip==='unknown'` (L190) to avoid cross-buyer session collision on misconfigured-proxy deploys. Card-only pin (L207).
- **`lib/rate-limit.ts getClientIp`** — Proxy headers trusted only under `TRUST_PROXY=true`; client selected immediately before the trusted suffix (L176), defaults to `'unknown'` rather than trusting a spoofable XFF. Decrement-not-delete rollback (L319) avoids concurrent-rollback count loss.

### Color binary parsers (bounds/off-by-one focus)
- **`lib/color-detection.ts parseCicpFromHeif`** — depth/scan caps (L230-231); 64-bit box size via `readBigUInt64BE` then `pos+size>buffer.length` break (no overflow exploit); `dataSize>=11` nclx gate (L263); per-field NCLX-over-ICC application that does NOT clobber ICC values on code-2 "Unspecified" (L393-398). NCLX maps are value-locked (out of scope per task; confirmed not re-raising).
- **`lib/icc-extractor.ts`** — `desc` path `strLen-1` correctly drops the trailing null (ICC desc length includes the terminator); `strStart>=strEnd` break guards a 1-byte (null-only) string. `mluc` per-record bounds check against both `iccLen` and `dataOffset+dataSize` (L93,103). tagCount/numRecords capped at 100; recLen/strLen capped at 1024. UTF-8 byte-clamp at 255 is code-point-safe (L13-26).
- **`lib/icc-chromaticity.ts`** — `offset+size>icc.length` per-tag guard (L247); UInt32BE offsets can't be negative; `chad` inversion null-checks det (L152); s15Fixed16 NaN-guarded (L107); `max(dR,dG,dB,dW)` metric correctly disambiguates sRGB vs AdobeRGB (differ only in green) and DCI-P3 vs P3-D65 (white-point Δ 0.022 > 0.015 tolerance); tie-break is first-preset-wins (`<`), deterministic via insertion order.
- **`lib/gain-map-detection.ts`** — depth/scan caps; entry/ref loops bounded at 1024; `readBoxHeader` validates `pos+size<=buffer.length`; URI null-terminated read clamped to box end; tmap-without-Apple-URN correctly deferred to heuristic-2 (L257-267). (Minor non-issue noted internally: an `infe` claiming a size past the iinf box but within the buffer could read sibling bytes — bounded by buffer.length, no OOB, only mis-detects gain-map on a malformed file; not actionable.)
- **`lib/gps-exif-strip.ts`** — REJ-R7C3-01 (iloc indexSize) re-examined and CONFIRMED correct: `indexSize` added only for version≥1 (L466), `extentEntrySize=indexSize+offsetSize+lengthSize` bounds-checked before each read (L513-514). JPEG post-EOI trailer rejection (L284), ExtendedXMP cross-chunk reconstruction (L326), TIFF IFD cycle-detection via `visited` set (L160), all type-size-validated. HEIF Exif TIFF region math (`start+4+headerOffset` … `start+length`) is in-bounds via the `headerOffset>length-8` guard (L537).

### Privacy / data flow
- **`lib/data.ts`** — `publicSelectFields` derived by destructure-omit from `adminSelectFields`; `_privacyGuard` (L419) compile-time-fails on any sensitive key leak; `_mapPrivacyGuard` (L431) auto-tracks the union minus lat/long; `avif_10bit` intentionally public (R10-M4) and consistent with CLAUDE.md; `PrivacySensitiveKeys` union matches the omit blocks. No leak path.

### Queue / backfill races
- **`lib/image-queue.ts`** — per-image advisory claim + `WHERE processed=false` conditional UPDATE; `affectedRows===0` delete-during-processing cleanup uses `[]` sizes for full-dir scan (L386); claim-retry path correctly deletes `enqueued` in `finally` (L549) while the setTimeout closure holds the re-entry; permanently-failed FIFO eviction cleans sibling maps (L510); hourly GC armed once via `!state.gcInterval` (L712).
- **`lib/admin-backfill-runner.ts`** — connection-budget concurrency cap arithmetic correct (cap=2 at pool 10); NaN-poolLimit fallback (L137); per-image claim covers encode→detect→UPDATE window; detection-failure leaves `pipeline_version` behind for resume; `affectedRows===0` deleted-mid-reencode cleanup + separate tally; closure-variable increments are atomic under JS single-threaded model (no lost updates at concurrency>1).
- **`scripts/backfill-color-pipeline.ts`** — batched UPDATE delete-mid-reencode partition correct; the detection-failure∩deleted overlap correctly removed from both `processed` and `detectionFailures` (AGG-C4-04, L444/L455); cleanup runs after transaction commit so a unlink error can't roll back sibling updates; exit code via tested `computeBackfillExitCode`.
- **`lib/view-retention.ts`** — negative/non-finite retention falls back to default (never future cutoff, L41,44); chunked DELETE with per-table iteration cap.

### Middleware
- **`proxy.ts`** — admin route guard format check (≥100 chars, 3 non-empty colon segments) is presence-only; full crypto validation stays in server actions; `/admin` (login) correctly excluded; API routes excluded from matcher with the documented "implement own auth" warning.

## Carried/adjudicated items — not re-raised (no new evidence)
- MED-R7C2-01 (histogram clip %) — REFUTED, not re-raised.
- REJ-R7C3-01 (gps-exif indexSize) — re-examined, DISPROVED confirmed, not re-raised.
- NCLX matrix/transfer map pin class — COMPLETE/EXHAUSTED, no "missing pin" findings filed.
- DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-R7C2-02..07, INFO-R7C2-08/09 — no new evidence / exit criteria unchanged; not re-raised.

## Recommendation

**APPROVE.** Zero CRITICAL/HIGH/MEDIUM/LOW new findings at any confidence. Converged source, clean typecheck, all targeted tests green. The truthful zero is the correct result.
