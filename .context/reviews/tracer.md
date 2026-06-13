# Tracer Report — GalleryKit deep-review fan-out (run-6 cycle-1)

Repo: `/Users/hletrd/flash-shared/gallery` (Next.js 16 / React 19 / TS6)
Working tree: uncommitted change in `apps/web/src/lib/admin-backfill-runner.ts` + its
companion test (AGG-5 concurrency cap). `.context/reviews/*.md` edits ignored as input.
HEAD = `8fc403a2`. Recent relevant commits: `13ae79ca` (backfill honesty, AGG-1),
`170297ed` (OG/JSON-LD global bidi strip, AGG-4).

Method: evidence-driven causal tracing — each flow traced end-to-end, competing
hypotheses stated, evidence for/against cited at file:line, conclusion with confidence.
Three pinning tests executed live at HEAD (all pass: 12/12).

---

## Summary

**Confirmed defects: 1** (low-severity documentation drift; no behavioral impact).
The four mandate flows that prior cycles flagged as dishonest/leaky are all **honest
at HEAD** — the AGG-1 / AGG-3 / AGG-4 fixes landed correctly and are pinned by tests.
The Stripe `async_payment_succeeded` gap (flow 2) is a confirmed, KNOWN, documented
limitation — correctly handled defensively (no false entitlement), not a regression.

| ID | Flow | Verdict | Confidence |
|----|------|---------|-----------|
| TRC-1 | Backfill last-run summary honesty | HONEST at HEAD (fixed) | High |
| TRC-2 | Stripe ACH `async_payment_succeeded` gap | Real gap, KNOWN+documented, defended | High |
| TRC-3 | EXIF bidi/zero-width → caption/title | FULLY STRIPPED (double defense) | High |
| TRC-4 | OG/JSON-LD multi-char bidi strip | FULLY STRIPPED (global regex) | High |
| TRC-5 | AGG-5 backfill concurrency-cap arithmetic | Logic correct; **stale doc comment** | High |

---

## TRC-1 — Backfill last-run summary honesty (mandate flow 1)

### Observation
Prior cycle (AGG-1, commit `13ae79ca`) claimed the admin backfill last-run summary
used to reconstruct `processed = lastQueuedCount − failures − skips`, dropping the
fatal `errors` counter, so a run where every per-row UPDATE threw rendered
"N re-encoded, 0 failures" with NO error line — reporting success and failure at once.

### Flow (end-to-end)
runner per-row catch (`errors++`, `state.lastError`) → `runBackfill` mirrors locals into
`AdminBackfillState` → `readAdminBackfillState()` → `getBackfillStatus()` server action →
`settings-client.tsx` render.

### Competing hypotheses
- **H1 (fixed):** UI now reads the runner's REAL `processed`/`errors` directly; a
  fatal-only run renders an honest summary with a non-zero error line.
- **H2 (dishonesty remains):** the reconstruction or a dropped-`errors` path survives.

### Evidence FOR H1
- `admin-backfill-runner.ts:642-654` — the per-row queue task `catch` increments
  `errors++` AND sets `state.lastError = err.message` (the AGG-1 addition; previously
  only the `encode-failed` branch set `lastError`).
- `:657-662` + `:688-693` — `state.processed`/`state.errors`/skip counters are mirrored
  from the function-locals continuously and on final flush. `processed` only increments
  on `result.ok` (`:619-620`) — it is never derived from `lastQueuedCount`.
- `:697-698` — `hadFailures = encodeFailures>0 || detectionFailures>0 || errors>0`;
  `state.lastRunHadFailures = hadFailures`. A fatal-only run (errors>0) sets the flag.
- `admin-backfill.ts:103-116` — `getBackfillStatus()` forwards `processed`, `errors`,
  `encodeFailures`, `detectionFailures`, `lastRunHadFailures`, `lastError` straight
  from state. No subtraction anywhere.
- `settings-client.tsx:286-287` — renders `processed: String(backfillStatus.processed ?? 0)`
  and `errors: String(backfillStatus.errors ?? 0)` DIRECTLY. `:308-312` renders the
  `lastError` line whenever `lastRunHadFailures && lastError`.
- **Live test (executed, passes):** `admin-backfill-runner-fatal-counters.test.ts:167-202`
  drives a fatal-only run (every version-bump UPDATE throws "Deadlock") and asserts
  `errors > 0`, `lastRunHadFailures === true`, `lastError` contains "Deadlock",
  `processed === 0`, `encodeFailures === 0`, `detectionFailures === 0`,
  `completedRuns > 0`. This is the exact dishonesty scenario, now pinned honest.

### Evidence AGAINST H1 / FOR H2
- None found. The reconstruction-subtraction shape no longer exists in any consumer.

### Rebuttal round
Strongest challenge to H1: could `lastError` be overwritten to a non-fatal message at
concurrency > 1, masking the fatal error? — The scalar `lastError` IS last-writer-wins
across workers (documented at `:649-651`), so the *message* may reflect whichever worker
threw last. But the COUNTS (`errors`) stay correct, `lastRunHadFailures` stays true, and
the summary still surfaces a non-zero error count + an error line. The honesty invariant
("never report success and failure at once with no error line") holds regardless. H1 stands.

### Conclusion — **HONEST at HEAD. No defect. Confidence: High.**
The AGG-1 fix is correct and pinned. A FATAL-error-only run renders
`processed=0, errors=N` plus the error message line.

### Uncertainty / next probe
At concurrency > 1 the displayed `lastError` is non-deterministic (last writer). If an
operator needs the FIRST fatal error rather than the last, that would require an
`errorSamples[]` array — a UX nicety, not a correctness defect. Not pursued.

---

## TRC-2 — Stripe paid-download entitlement / ACH gap (mandate flow 2)

### Observation
CLAUDE.md and the webhook docblock both state `checkout.session.async_payment_succeeded`
is not handled: ACH / bank-transfer / OXXO / Boleto complete checkout but funds settle
asynchronously, so the entitlement row is never written → download permanently 404s.

### Flow (end-to-end)
Stripe Checkout → `POST /api/stripe/webhook` → entitlement INSERT → customer clicks link →
`GET/POST /api/download/[imageId]?token=…` → `validateDownloadRequest` → entitlement lookup.

### Competing hypotheses
- **H1 (gap real, defended):** only `checkout.session.completed` with `payment_status==='paid'`
  is handled; async-settled methods get no entitlement; download returns 404 — but the
  webhook NEVER mints a false entitlement for unpaid funds (correct defensive posture).
- **H2 (silent false entitlement):** async sessions slip through and mint an entitlement
  before funds settle (a worse bug — paying out access before payment).
- **H3 (the gap is actually closed):** some other handler catches the async event.

### Evidence FOR H1
- `webhook/route.ts:88` — the ENTIRE handler body is gated by
  `if (event.type === 'checkout.session.completed')`. `grep` across `apps/web/src`
  (non-test) finds exactly TWO references to async handling: the gate at `:88` and the
  DEFERRED comment at `:99`. No `async_payment_succeeded` / `payment_intent.succeeded`
  case exists.
- `:105-118` — even within `completed`, `if (session.payment_status !== 'paid')` returns
  `200 {received:true}` WITHOUT writing an entitlement. `'unpaid'` (the async happy path)
  is logged at `console.warn` (not error, to avoid PagerDuty pages — C4-RPF-03). This is
  H1's defensive core: an async session that fires `completed` while still `unpaid` is
  correctly REJECTED rather than minting access. **This disproves H2.**
- `download/[imageId]/route.ts:139-166` — when no entitlement row matches the token hash,
  `validateDownloadRequest` returns `404 "Token not found"` (`:166`). (A used-but-cleared
  row returns 410; an unknown token returns 404.) So the downstream symptom of the gap is
  a permanent 404 — exactly as documented.

### Evidence AGAINST H1
- None. The behavior matches the documented limitation precisely.

### Rebuttal round
Strongest challenge: does Stripe ever deliver `async_payment_succeeded` data inside a
later `checkout.session.completed` with `payment_status==='paid'`? — No. For delayed
payment methods Stripe fires `checkout.session.completed` (often `unpaid`/`processing`)
THEN a SEPARATE `checkout.session.async_payment_succeeded` when funds clear. The second
event type is the one not subscribed/handled here, so the settled customer never gets a
row. H1 stands; the gap is real and customer-impacting for ACH/bank-transfer buyers.

### Conclusion — **Real gap, KNOWN + documented, correctly DEFENDED. Confidence: High.**
This is NOT a regression and NOT a false-entitlement bug. It is a coverage gap for
delayed-settlement payment methods: such a customer pays, funds settle, but no
entitlement is ever written → their download link 404s forever, with no audit row tying
the Stripe payment to the image. CLAUDE.md attributes the fix to plan-316 CRT-R5C1-04
(not yet shipped). Card / immediate-payment methods are fully covered.

### Next probe (fix shape, if prioritized)
Add an `else if (event.type === 'checkout.session.async_payment_succeeded')` branch that
re-runs the same paid-path body (it already re-checks `payment_status==='paid'`, validates
metadata, and is idempotent via the `sessionId` SELECT + `onDuplicateKeyUpdate`). Confirm
the Stripe webhook endpoint subscription includes that event type in the dashboard.

---

## TRC-3 — EXIF bidi/zero-width → caption / title (mandate flow 3, AGG-3)

### Observation
AGG-3 concern: a `Model` / title EXIF string carrying Unicode bidi (U+202E) or
zero-width chars could survive to the stored DB value (caption stub → `images.title`).

### Flow (end-to-end)
EXIF `Model` → `extractExifForDb` → `cleanString` = `cleanMetadataString` →
`camera_model` → `enqueueImageProcessing` → `generateCaption(camera_model, capture_date)`
→ `images.alt_text_suggested` → admin "apply alt as title" → `bulkUpdateImages`
`applyAltSuggested` → `images.title` / `images.description`.

### Competing hypotheses
- **H1 (stripped at source):** `cleanMetadataString` strips ALL bidi/zero-width chars at
  ingest, so `camera_model` (and the caption derived from it) is clean before storage.
- **H2 (survives):** the strip is missing, partial (non-global), or only at the reject
  layer (which EXIF bypasses).

### Evidence FOR H1
- `process-image.ts:574` — `cleanMetadataString` does
  `(stripUnicodeFormatting(String(value)) ?? '').replace(/\0/g,'').trim()`. The
  `stripUnicodeFormatting` call is the SOURCE defense; comment `:568-573` states EXIF
  strings never pass the admin validation layer, so this is where they get scrubbed.
- `validation.ts:82,92-94` — `stripUnicodeFormatting` uses `UNICODE_FORMAT_CHARS_GLOBAL =
  new RegExp(UNICODE_FORMAT_CHARS.source, 'g')` and `value.replace(…GLOBAL, '')`. The
  `/g` flag replace-alls — every bidi/zero-width char removed, not just the first.
  `UNICODE_FORMAT_CHARS` (`:58`) covers U+180E, U+200B-200F, U+202A-202E, U+2060,
  U+2066-2069, U+FEFF, U+FFF9-FFFB — the full Trojan-Source set.
- `process-image.ts:1389` — `camera_model: cleanString(imageParams.Model)` →
  `cleanString` = `cleanMetadataString` (`:1292-1294`). The `Model` tag is scrubbed.
- `image-queue.ts:388-392` — `generateCaption(...)` output is stored into
  `alt_text_suggested`; its inputs (`camera_model`, `capture_date`) are already cleaned.
- **Second (write-time) defense:** `images.ts:1007` — `applyAltSuggested` copies
  `stripUnicodeFormatting(stripStubPrefix(row.alt_text_suggested))` into `title`/
  `description`. So even a pre-fix legacy row or future producer drift is re-stripped at
  the persist boundary (`:998-1008` documents this belt-and-braces intent).

### Evidence AGAINST H1
- None. Two independent strip points cover the path.

### Rebuttal round
Strongest challenge: is there a write path to `images.title` that bypasses BOTH strips —
e.g. a direct admin title edit with bidi chars? — Yes, but admin title edits go through
the validation REJECT layer (`containsUnicodeFormatting`, `validation.ts:73-74`, applied
to `image.title` per CLAUDE.md C5L-SEC-01), which rejects bidi at entry rather than
stripping. So that path is also covered, by a different mechanism. The EXIF-derived path
(this flow) is covered by stripping at source + persist. H1 stands.

### Conclusion — **FULLY STRIPPED. No defect. Confidence: High.**
A `Model`/title EXIF string with one OR many bidi/zero-width chars is fully scrubbed
before it reaches the stored DB value, via the global-flag `stripUnicodeFormatting` at
both `cleanMetadataString` (source) and `applyAltSuggested` (persist).

### Uncertainty
No dedicated test pins `cleanMetadataString`'s multi-char bidi strip directly (the
function is internal/non-exported). The behavior is guaranteed by the shared
`stripUnicodeFormatting` which IS tested (`sanitize-for-og-global.test.ts`). A direct
fixture on `extractExifForDb` with a multi-bidi `Model` would harden against future
refactors that bypass `cleanMetadataString`. Low priority.

---

## TRC-4 — OG / JSON-LD multi-char bidi strip (mandate flow 4, AGG-4)

### Observation
AGG-4 (commit `170297ed`): both `sanitizeForOg` helpers (OG image route + photo-page
JSON-LD) used `value.replace(UNICODE_FORMAT_CHARS, '')` with a NON-global regex, so only
the FIRST bidi/zero-width char was stripped; a `camera_model`/title with 2+ leaked the
rest into the public OG card and structured data.

### Flow
`image.camera_model` / title (admin-controlled or EXIF-derived) → `sanitizeForOg(value)`
→ OG `ImageResponse` text / JSON-LD `value` field served to the public.

### Competing hypotheses
- **H1 (fixed):** both helpers now route through the global-flag `stripUnicodeFormatting`,
  removing ALL bidi/zero-width chars.
- **H2 (non-global survives):** one or both helpers still call the non-global
  `UNICODE_FORMAT_CHARS.replace`, leaking all-but-first.

### Evidence FOR H1
- `og/photo/[id]/route.tsx:8,36-37` — `import { stripUnicodeFormatting }`; `sanitizeForOg`
  returns `(stripUnicodeFormatting(value) ?? '').replace(OG_C0_CONTROL_CHARS, '')`. Used
  at `:98,100` for `siteTitle`/`displayTitle`.
- `p/[id]/page.tsx:9,42-43` — `import { stripUnicodeFormatting }`; `sanitizeForOg` returns
  `stripUnicodeFormatting(value) ?? ''`. Used at `:233-237` for camera_model, lens_model,
  exposure_time JSON-LD values.
- `validation.ts:82,92-94` — `stripUnicodeFormatting` is the `/g`-flag replace-all twin
  (see TRC-3 evidence). Global ⇒ all occurrences removed.
- **Live test (executed, passes):** `sanitize-for-og-global.test.ts` (49 lines) pins the
  multi-char strip on both files AND forbids regression to the non-global
  `.replace(UNICODE_FORMAT_CHARS, …)` call form. `grep` confirms zero non-global
  `UNICODE_FORMAT_CHARS.replace` call sites in either file.

### Evidence AGAINST H1
- None.

### Rebuttal round
Strongest challenge: does `UNICODE_FORMAT_CHARS_GLOBAL`'s shared `lastIndex` state cause a
stateful-regex skip bug across calls (the classic `/g` + `.test()` footgun)? — No.
`stripUnicodeFormatting` uses `.replace()` (which resets `lastIndex` to 0 on each call,
unlike `.test()`/`.exec()`), and `validation.ts:80-82` deliberately keeps the `/g`
instance SEPARATE from the `.test()`-only `UNICODE_FORMAT_CHARS` so no `lastIndex`
contamination leaks into the rejection helper. H1 stands.

### Conclusion — **FULLY STRIPPED. No defect. Confidence: High.**
A string with multiple bidi/zero-width chars is now fully sanitized in both the OG card
and JSON-LD. The non-global regression is fixed and pinned.

---

## TRC-5 — AGG-5 backfill concurrency-cap arithmetic (chosen flow 5; live uncommitted change)

### Observation
The only NON-doc uncommitted change reworks `resolveBackfillConcurrency`
(`admin-backfill-runner.ts`) from `floor((LIMIT-2)/2)` (cap 4 at LIMIT=10) to a
reserved-headroom formula `floor((LIMIT-RESERVED-1)/2)` (cap 2 at LIMIT=10), where
`RESERVED = max(3, ceil(LIMIT/2))`. Rationale: a single live `getImage()` fires a ~3-way
`Promise.all`, so reserving only 1 connection starved live photo-page renders during a
backfill.

### Flow
`ADMIN_BACKFILL_CONCURRENCY` env → `resolveBackfillConcurrency(requested, POOL_LIMIT)` →
PQueue `concurrency` → worst-case held connections vs the shared pool of 10.

### Competing hypotheses
- **H1 (correct + consistent):** the new arithmetic is internally consistent, leaves
  ≥ RESERVED connections free, and the test was updated to match.
- **H2 (off-by-one / under-reservation):** the formula still lets a backfill pin too many
  connections, or the worst-case hold model (`1 + 2N`) understates real usage.
- **H3 (doc drift):** the behavior is right but a companion comment now lies.

### Evidence FOR H1
- `admin-backfill-runner.ts:100-101,132-136` — `reserved = max(3, ceil(10/2)) = 5`;
  `cap = max(1, floor((10-5-1)/2)) = floor(4/2) = 2`. Worst-case held = `1 (lock) + 2×2
  (workers) = 5`; free = `10 − 5 = 5 ≥ reserved (5)`. Internally consistent.
- `db/index.ts:19` — `POOL_CONNECTION_LIMIT = 10`, `connectionLimit: 10` (`:27`). The
  arithmetic input is correct.
- **Live test (executed, passes):** `admin-backfill-concurrency-cap.test.ts` updated to
  assert cap 2 at LIMIT=10, scaling (LIMIT=20 → reserved 10 → cap 4), small-pool floors
  (LIMIT 3/4/6 → cap 1), AND a NEW invariant test (`:69-78`): `limit − (1 + 2*cap) >=
  reserved`. This is exactly H1's core claim, machine-verified.

### Evidence FOR H3 (the one real defect)
- `db/index.ts:16` — the exported-constant docblock STILL reads "caps its effective
  concurrency at floor((POOL_CONNECTION_LIMIT - 2) / 2)". That is the PRE-AGG-5 formula.
  The runner's actual formula is now `floor((LIMIT-RESERVED-1)/2)`. The AGG-5 change
  updated the runner + its test but left this companion comment describing the old math.
  An operator reading `db/index.ts` to understand the budget gets the wrong formula
  (would compute cap 4, observe cap 2).

### Evidence AGAINST H2
- The `1 + 2N` hold model is sound: the per-image claim conn is held across
  encode→detect→UPDATE (`reprocessOne:421-535`), and the `db.execute` UPDATE pulls one
  MORE pool conn transiently while the claim conn is held (`:494-507`). During
  `processImageFormats` (the long encode) only the claim conn is held (no DB), so 2/worker
  is the true ceiling, not an understatement. A pool-exhausted claim acquire degrades to a
  `locked` skip (`:424-430`), not an error spin — so even if the budget were briefly
  exceeded by competing live traffic, the backfill backs off rather than wedging. H2 is
  not supported.

### Rebuttal round
Strongest challenge to H1: at `concurrency = 2`, is the docblock's "pins at most 1 + 2×2 =
5" actually reachable, or do workers serialize on Sharp/libheif and hold only 1 conn
each? — In the worst case both workers are simultaneously in their `db.execute` UPDATE
(claim conn + UPDATE conn each = 4) plus the lock = 5. That is genuinely reachable and is
the bound the formula budgets for. So the conservative model is correct, not pessimistic.
H1 stands; the only crack is the stale comment (H3).

### Conclusion — **Logic CORRECT and consistent; ONE confirmed defect: stale doc comment.**

**TRC-5-DEFECT (LOW, doc-only):** `apps/web/src/db/index.ts:16` describes the backfill cap
as `floor((POOL_CONNECTION_LIMIT - 2) / 2)` — the obsolete pre-AGG-5 formula. The shipped
runner uses `floor((LIMIT - RESERVED - 1) / 2)` with `RESERVED = max(3, ceil(LIMIT/2))`.
No behavioral impact; a maintenance/documentation-drift hazard only. Fix: update the
comment to the AGG-5 formula (or point to `resolveBackfillConcurrency` /
`BACKFILL_RESERVED_LIVE_CONNECTIONS` as the single source of truth). Confidence: High.

### Uncertainty
The runner's own docblock (`:91-122`) IS correctly updated. Only the cross-module comment
at `db/index.ts:16` drifted. No functional uncertainty.

---

## Convergence / separation notes
- TRC-3 and TRC-4 converge on ONE root mechanism: the global-flag `stripUnicodeFormatting`
  (`validation.ts:92-94`). Both flows are clean because that single helper replace-alls.
  They are independently evidenced (different call sites, separate tests), so the
  convergence is real, not fake.
- TRC-1 and TRC-2 are genuinely distinct (in-process state mirroring vs Stripe event-type
  coverage) — no shared root.
- TRC-5's defect is isolated to a cross-module doc comment; the behavioral logic shares no
  root with the others.

## Critical unknown (across all flows)
None blocking. The single confirmed defect (TRC-5 doc drift) needs no further evidence.
The Stripe ACH gap (TRC-2) is a product-coverage decision (plan-316), not a tracing
ambiguity.

## Discriminating probe (highest value, if one were needed)
For TRC-2, the one probe that would collapse any remaining doubt about customer impact:
inspect the Stripe webhook endpoint's SUBSCRIBED event list in the Stripe dashboard — if
`checkout.session.async_payment_succeeded` is not subscribed, the gap is delivery-level
(event never arrives) on top of the code-level gap (no handler). Both point to the same
permanent-404 outcome for ACH buyers.
