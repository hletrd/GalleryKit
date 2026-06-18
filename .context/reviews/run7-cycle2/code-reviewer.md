# Code Reviewer — Run-7 Cycle-2 Deep Review

**Agent:** code-reviewer (lane: code quality, logic correctness, SOLID, maintainability, error handling, edge cases)
**HEAD:** `1cdbb883` (working tree clean except untracked `.context/reviews/run7-cycle2/`)
**Date:** 2026-06-18
**Scope:** whole-repo, functional source under `apps/web/src/`. Examined the cycle-1 fix files in full, all three already-raised findings, plus an independent lane sweep of logic-dense modules (smart-collections, view-retention, request-origin, analytics-data, histogram, image-queue, admin-backfill-runner, color-detection, money/checkout/webhook paths) and a final commonly-missed sweep.

---

## Verdict: **APPROVE** (with one concurrence + one refinement)

No new code-quality or logic defect surfaced in my lane. The functional delta since the run-6 cycle-11 converged baseline is tiny (the cycle-1 NCLX-YCgCo fix + the Firefox-MQ doc/comment reword + a SW version stamp); both code changes landed cleanly with no regression. The three findings already raised by other reviewers this cycle are correctly characterized; I add authoritative confirmation to one and a numerical-correctness refinement to another.

| Item | My disposition |
|---|---|
| R7C2-F1 (NCLX transfer code 5) | **CONCUR** — spec-confirmed; LOW (admin-label only, no delivery impact) |
| MED-R7C2-01 (histogram clip denominator) | **REFINE -> not a runtime bug** — numerically harmless; downgrade to LOW code-clarity nit |
| TE-R7C2-01 (browser GPS-strip toggle untested) | **CONCUR** — test-gap (test-engineer lane) |
| New code-reviewer findings | **0** |

---

## Summary table of findings

| ID | Severity | Confidence | File:line | One-liner |
|---|---|---|---|---|
| CR-R7C2-01 | LOW | HIGH | `lib/color-detection.ts:183`, `__tests__/color-detection.test.ts:206-217` | NCLX transfer code 5 = BT.470BG gamma **2.8**, mislabeled "BT.470 System M" and mapped to `gamma22`; concurs with R7C2-F1, spec-confirmed. Admin-audit-label only, no delivery-byte impact. |
| CR-R7C2-02 | LOW | HIGH | `components/histogram.tsx:322-328`, `:651-654` | RGB clip percentage divides a max-across-r/g/b numerator by the **red** channel total. Numerically harmless (worker guarantees equal channel sums) but the dead `.map()` over all three totals signals an unrealized intent — refines MED-R7C2-01 down to a code-clarity nit. |

No CRITICAL/HIGH/MEDIUM findings. Both LOW items are characterized by other reviewers' lanes (spec/doc + debugger); I add evidence, not a new schedulable defect.

---

## Detail

### CR-R7C2-01 [LOW, conf HIGH] — NCLX transfer code 5 is gamma 2.8 (BT.470BG), not gamma 2.2/"System M" (CONCUR with R7C2-F1)

**Where:**
- Code: `apps/web/src/lib/color-detection.ts:182-185`
  ```
  4: 'gamma22', // ITU-T H.273 Gamma 2.2 curve
  5: 'gamma22', // BT.470 System M      <- WRONG comment + arguably wrong value
  6: 'gamma22',
  7: 'gamma22', // SMPTE 240M
  ```
- Test: `apps/web/src/__tests__/color-detection.test.ts:206-217` — comment "values 4, 5, 7 (gamma-2.2 family)" + `it('maps nclx transfer=5 to gamma22')` asserting `toBe('gamma22')`.

**Authoritative source (ITU-T H.273 Table 3, verified via web search 2026-06-18):**
- Code **4** = BT.470-6 **System M** (historical), assumed display **gamma 2.2**.
- Code **5** = BT.470-6 **System B, G** (historical, PAL), assumed display **gamma 2.8**.
- Code **6** = BT.601 / SMPTE 170M (gamma-2.2 family).
- Code **7** = SMPTE 240M (gamma-2.2 family).

So two things are wrong at line 183: (a) the comment attributes "System M" to code 5, but System M is code **4** (code 5 is System B,G); (b) code 5's assumed display gamma is **2.8**, not 2.2.

**Why I rate it LOW (and why it is genuinely deferrable as a doc/spec item, not a code-reviewer-lane defect):**
1. **No `gamma28` enum exists** in the `transferFunction` union (`color-detection.ts:25`). A "fully correct" value-fix would require adding a `gamma28` member to the union, a `case 'gamma28'` to `humanizeTransferFunction` (`color-details-section.tsx:70-80`), a new i18n key in `en.json` + `ko.json`, and a test update — a multi-site change for a code that essentially never appears in still-photo NCLX boxes. The cheap correct fix is comment-only ("BT.470 System B,G — assumed display gamma 2.8; mapped to closest exposed label gamma22").
2. **Zero delivery-byte impact** (traced): `transfer_function` is consumed in exactly two places — written to the DB at `images.ts:359`, and read for the admin audit label via `humanizeTransferFunction`. The encoder decision matrix keys on `color_pipeline_decision` / `colorPrimaries`, and HDR gating keys on `isHdr` (only `pq`/`hlg` flip it). A wrong transfer label for code 5 changes one admin-only audit string and nothing on the wire.
3. The test is "actively pinning the wrong value" only in the sense that it pins a comment-mislabeled mapping; the runtime label it produces (`gamma22`) is at least gamma-family-adjacent, not categorically absurd.

**Failure scenario:** A photographer exports a Rec.601-era PAL still (or a tool stamps NCLX transfer=5) and an admin opens Color Details — the audit row reads "Gamma 2.2" when the authored intent is gamma 2.8. Cosmetic admin mislabel; no end-user/delivery effect.

**Suggested fix (cheapest correct):** change the `color-detection.ts:183` comment to cite BT.470 System B,G / gamma 2.8 and note the deliberate collapse to the `gamma22` label (no `gamma28` exposed); update the `color-detection.test.ts:206` comment so it no longer claims code 5 is "gamma-2.2 family". If the repo wants full fidelity, add `gamma28` end-to-end. This is a doc-specialist / test-engineer lane item (already raised as R7C2-F1); I confirm it against the spec and bound its impact.

---

### CR-R7C2-02 [LOW, conf HIGH] — Histogram RGB clip percentage divides by the red-channel total (REFINES MED-R7C2-01 down to a non-bug)

**Where (the pattern appears TWICE):**
- `apps/web/src/components/histogram.tsx:321-329` (canvas clip-blink strips):
  ```
  const totals = [data.r, data.g, data.b].map((ch) => ch.reduce((s, v) => s + v, 0));
  total = totals[0];                                        // red total only
  belowBlack = Math.max(data.r[0], data.g[0], data.b[0]);   // max across channels
  aboveWhite = Math.max(data.r[255], data.g[255], data.b[255]);
  if (total > 0) { belowBlack /= total; aboveWhite /= total; }
  ```
- `apps/web/src/components/histogram.tsx:651-663` (the on-screen "% below black / above white" labels) — same shape: `total = histogramData.r.reduce(...)`, numerator is `Math.max` across r/g/b.

**The debugger flagged this (MED-R7C2-01) as a possible correctness bug: "divides by the red-channel total only."** I traced it to ground truth and it is **NOT a runtime defect:**

The histogram worker (`apps/web/public/histogram-worker.js:24-33`) increments `r[rv]++; g[gv]++; b[bv]++` **unconditionally, once per pixel**, for every pixel. Therefore `sum(r) === sum(g) === sum(b) === width*height` exactly — the three channel totals are mathematically identical by construction. Dividing the worst-case channel's clip count by `totals[0]` (red total) yields exactly the same fraction as dividing by the correct channel's own total. The displayed percentage is correct.

**So the real issue is code clarity / latent fragility, not output correctness:**
1. The `.map()` at line 322 computes all three totals but uses only `totals[0]` — `totals[1]` and `totals[2]` are dead computation, signaling an intent ("normalize each channel by its own total") that is not realized. A future reader could "fix" it into something wrong, or the equal-sums invariant could silently break if the worker is ever changed to skip pixels per-channel (e.g. an alpha/transparency or NaN-skip optimization) — at which point this code would start dividing by the wrong total with no failing test.
2. The numerator/denominator mismatch (per-channel max numerator / red-only denominator) reads as a bug even though it isn't, costing future-reviewer time (it already cost the debugger a finding this cycle).

**Failure scenario (latent, not current):** if a future contributor changes the worker to count only opaque pixels per-channel (so channel sums diverge), the RGB clip % would silently use red's total for a green/blue-dominated clip — a wrong but plausible-looking percentage with no test catching it.

**Suggested fix (zero behavior change today):** drop the dead `.map()` and divide each channel's clip count by its own channel total, then take the max of the per-channel fractions; or, simpler and equally correct under the current invariant, divide the max-numerator by `width*height` (the pixel count) with a comment stating the equal-sums invariant. This is a maintainability cleanup, not a correctness fix; it is defensibly deferrable since output is correct today.

---

## Rejected candidates (investigated and disproved — do NOT re-litigate next cycle)

- **REJ-CR-R7C2-A — Histogram RGB clip "divides by red total" as a correctness bug.** Disproved: the worker (`histogram-worker.js:24-33`) counts every pixel into all three channels unconditionally -> `sum(r)==sum(g)==sum(b)`, so the denominator choice is numerically irrelevant. Recorded as CR-R7C2-02 (clarity nit), not a bug. (This bounds MED-R7C2-01.)
- **REJ-CR-R7C2-B — `use-display-capability.ts` snapshot memoization / Firefox fallback.** Verified clean at HEAD. The cycle-1 comment reword landed; `detect()` caches by value (guards React #185), the Firefox MQ-always-false fallback to `'srgb'` is correct, `subscribe()` cleans up all listeners. No defect.
- **REJ-CR-R7C2-C — `smart-collections.ts` query compiler open-union / injection.** Verified airtight: `JSON.parse` wrapped (`:309-313`), `validateNode` enforces scalar values + depth bound + IN-length bound + per-column operator narrowing (tag -> eq/contains only), `compilePredicate` switch has an exhaustive `default` throw, all values flow through Drizzle parameter binding / escaped LIKE. No issue.
- **REJ-CR-R7C2-D — `view-retention.ts` cutoff-in-future on bad env.** Verified: `resolveRetentionMs` falls back to the 395-day default on non-finite / non-positive `VIEW_RETENTION_DAYS`; chunked DELETE with `MAX_BATCHES_PER_TABLE` iteration cap. Correct (mirrors the audit-log COR-R4C6-10 guard).
- **REJ-CR-R7C2-E — `request-origin.ts` host port-strip off-by-one.** Verified: `:443` is 4 chars -> `slice(0,-4)`; `:80` is 3 chars -> `slice(0,-3)`; both exact. `toOrigin` try/catch guards `new URL`. Fail-closed default in `hasTrustedSameOriginWithOptions`. No issue.
- **REJ-CR-R7C2-F — fire-and-forget embedding IIFE unhandled rejection (`image-queue.ts:434`).** Verified: the IIFE wraps the config fetch in try/catch AND the embed/insert in try/catch (`:443-477`), so `embedImageReal` throwing (offline weight-load failure) becomes a caught `console.warn`, never an unhandled rejection. The sibling caption hook (`:395-410`) has both `.then` inner-try and a trailing `.catch`. No process-crash path.
- **REJ-CR-R7C2-G — money/entitlement float arithmetic.** Verified: amounts handled as integer cents end-to-end (`amountTotalCents`, `unit_amount: priceCents`); webhook validates `Number.isInteger(amountTotalCents) && amountTotalCents > 0` (`stripe/webhook/route.ts:299`). No float-rounding money bug.
- **REJ-CR-R7C2-H — `fetchCandidateCount` rows[0] OOB (`admin-backfill-runner.ts:377`).** Verified: explicit `if (!rows[0]) return 0` guard before `Number(rows[0].cnt)`. Safe.

---

## Final commonly-missed sweep

| Check | Result |
|---|---|
| **Off-by-one** | `percentileFromHistogram` (histogram.tsx:351-361) loop bound `i < bins.length`, returns `bins.length-1` fallback — correct. Grid loop over `[0,64,128,192,255]` correct. No `<=` array-length loops in modified surfaces. |
| **null/undefined chains** | `data.colorSignals?.colorPrimaries ?? null` etc. throughout `images.ts:355-362` — all optional-chained with `??` fallback. `rows[0]` accesses guarded (backfill-runner). |
| **Unhandled promise rejection** | Fire-and-forget IIFEs (embedding, caption) both fully try/catch-wrapped (REJ-CR-R7C2-F). `void`-prefixed async at `image-queue.ts:434` intentional + guarded. |
| **switch without default over open union** | `compilePredicate` (smart-collections:201), `humanizeTransferFunction` (color-details-section:70), `humanizeMatrixCoefficients` (:101), `getGamutLabel` (histogram:417) — all have a `default` arm. None missing. |
| **integer/float edge** | Money in integer cents (REJ-CR-R7C2-G). `Number.parseInt(VIEW_RETENTION_DAYS)` + finite/positive guard. Histogram totals are integer counts. No float-equality on money/identity. |
| **race windows** | Queue claim (advisory lock + conditional UPDATE), backfill non-snapshot keyset (documented invariants a+b), delete-mid-reencode (`affectedRows===0` cleanup) — all previously verified, unchanged at HEAD. No new race in the cycle-1 delta. |
| **resource leaks** | `fileHandle.close()` in `finally` (color-detection:337-339), `lockConn.release()` in `finally` (backfill-runner:365-367), best-effort `fs.unlink(...).catch(()=>{})` cleanups deliberate. No leaked handles/connections. |
| **silent catch** | All empty catches are documented best-effort file cleanup or "DB unavailable — skip" fallbacks with intent comments; none swallow a correctness-bearing error silently. |

---

## Bottom line

The codebase remains **converged**. The only functional code change since the last converged baseline (the cycle-1 NCLX-YCgCo fix and Firefox-MQ comment reword) landed correctly with no regression. I found **no new code-quality or logic defect** in my lane. I confirm R7C2-F1 against the ITU-T H.273 spec and bound its impact to a single admin audit label (LOW), and I refine MED-R7C2-01: the histogram clip "red-total denominator" is **numerically harmless** because the worker guarantees equal channel sums — it is a code-clarity nit (CR-R7C2-02), not a runtime bug. A small or zero net-new finding count is the expected and honest outcome at this stage; I did not manufacture findings.
