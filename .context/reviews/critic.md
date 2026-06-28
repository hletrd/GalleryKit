# Critic — Run-21 Cycle-21 (skeptical multi-perspective pass over the cycle-20 change surface + the loop)

**Date:** 2026-06-29
**HEAD:** 993ed471 (run-20 cycle-20 fixes T1–T7 + SW stamp landed)
**Scope:** Pressure-test every cycle-20 deliverable for COMPLETENESS (did the sweep miss a sibling?) and CORRECTNESS (no regression / weakened invariant); re-decide deferred exit-criteria; judge whether the loop is still producing value or churning.
**Method:** Read cycle-20 critic + aggregate + plan + deferred. Independently inspected the 8 cycle-20 fix commits (075a768e…993ed471) + the touched modules + the broader architecture. Wrote and ran a standalone source scanner for styled `<Link>/<a>/<button>` lacking `focus-visible:` across `components/` + `app/`. Ran all gates.

**Baseline gates (re-run at HEAD by me):** typecheck exit 0 · vitest **2168 pass / 4 skip (240 files)** (up from cycle-20's 2155 — the T1/T2/T3/T5 tests landed) · lint:api-auth / lint:action-origin / lint:public-route-rate-limit all PASS.

**VERDICT: ACCEPT-WITH-RESERVATIONS.** Every cycle-20 fix (T1–T7) is correct, tested, and gates-green. None is a paper fix. Three reservations: (1) the focus-visible scanner is now at its OWN committed no-further-deferral deadline (cycle-20 plan: "broad scanner COMMITTED for cycle 21 … no further deferral past then") AND my scan proves T3 left ~14 sibling links unfixed — the loop's signature "fix one sibling, miss the next" is demonstrably still live; (2) the T7 doc-gap sweep itself missed a doc-code drift (`SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX` documented as env-tunable but hardcoded constants); (3) A3 single-settle deferral is policy-compliant (exit criterion verified UNMET) but is now on its 4th cycle and wants the same hard-trigger discipline.

**Findings:** 1 MAJOR (process/structural — scanner due + T3 incomplete) · 3 MINOR · 2 What's-Missing/latent · loop-value verdict.

**Mode: THOROUGH.** No CRITICAL (zero shipped live defects — the Realist Check downgraded the only candidate, focus-visible, from potential-WCAG to cosmetic). No 3+ MAJOR. No escalation to ADVERSARIAL warranted.

---

## Pre-commitment predictions vs findings
Predicted before inspecting: (a) the T1 env sweep would miss at least one numeric env site somewhere less obvious (scripts / a helper / a documented-but-uncoded var); (b) T2's walkAborted fix would either be mis-placed or leave a parallel walker (JPEG/TIFF) with the same fail-open shape; (c) T3 focus-visible would miss public siblings — the loop's trademark; (d) a deferred exit criterion would now be met.
Actuals: (a) **partially confirmed** — the *code* env sites are all swept, but the DOCUMENTED `SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX` "runtime limits" are not env-read at all (hardcoded consts) — a drift T7's doc sweep should have caught (CRIT21-02); (b) **refuted** — walkAborted is placed correctly (unconditional, line 470) and the JPEG/TIFF paths are structurally fail-closed (return null inline on any anomaly), so no parallel gap; (c) **confirmed, with a realist twist** — ~19 styled siblings lack the custom ring, but none set `outline-none`, so they keep the UA-default ring → cosmetic, not WCAG (CRIT21-01); (d) **confirmed** — the focus-visible scanner is contractually due this cycle.

---

## Cycle-20 fix pressure-test (does each close the hole or move it?)

### T1 — env-parse `Number()` sweep — COMPLETE. (confidence HIGH)
Swept `audit.ts:116`, `process-image.ts:46/334/344`, `images.ts:797`, `rate-limit.ts:144`, `upload-limits.ts:11`. I independently enumerated EVERY numeric env read in `src` + `scripts`: all now use `Number(...)` (or already did — `image-queue.ts:212` QUEUE_CONCURRENCY, `admin-backfill-runner.ts:665` ADMIN_BACKFILL_CONCURRENCY, `db/index.ts:27` DB_PORT, `scripts/backfill-*.ts` BACKFILL_CONCURRENCY). The remaining `parseInt` calls in `src` are all URL/form-param or session-token parsing (`session.ts:128`, `topics.ts:108/211`, route `[id]` params) — a different validation domain, correctly out of scope. The `SEMANTIC_*` limits are NOT env-read (hardcoded consts — see CRIT21-02), so excluding them from T1 was correct. The test (`upload-limits-env.test.ts`) is non-vacuous: asserts `2e9`→2_000_000_000, fractional floor `1.5e9`, plain int, and the empty/NaN/negative fallbacks. **No residual.** The only nit is CRIT21-04 (Math.floor asymmetry — non-actionable).

### T2 — gps-strip `walkAborted` on items-found path — CLOSES IT, complete. (confidence HIGH)
`gps-exif-strip.ts:470` now hoists `if (walkAborted) return null;` ABOVE the empty-items branch (cycle-19 had it inside that branch only). I checked the two predicted weak points and both hold: (1) the shared-closure `walkAborted` is set by the same generator at all three call sites (top-level/iinf/infe), so a partial infe walk after ≥1 Exif item is now correctly caught; (2) **the parallel format strippers do NOT share this bug** — `stripGpsFromJpegBuffer` collects all segments first and `return null`s inline on any malformed marker (`:248/252/259/261`) before the strip loop, and `stripGpsFromTiffRegion` returns `null` inline on every structural anomaly (`:104–185`). Only the ISOBMFF "collect-then-decide" shape could fail open, and that's now closed. The test is a proper discriminator: items-found + oversized-64-bit box ⇒ `toBeNull()`, with a negative control (same buffer minus the abort box ⇒ `{stripped:false}`) proving the null is driven by the abort, not the item presence. Realist: incidence negligible (single Exif item is standard HEIF), found item's GPS IS already neutralized — so this is doctrine-consistency/defense-in-depth, correctly LOW. **No residual.**

### T5 — OG per-attempt timeout < total budget — CLOSES the named hole. (confidence HIGH)
`og-photo-fetch.ts:41` `OG_PHOTO_FETCH_TIMEOUT_MS=3500` is now strictly below `OG_PHOTO_TOTAL_BUDGET_MS=10000` (:54, now exported), so a hung path gets ~2 real fallback attempts instead of one 10 s hang. Deadline check `if (Date.now() >= deadline) break;` is at loop top (one in-flight attempt may finish ⇒ worst case ~10.5 s — acceptable, matches the documented intent). The new fake-timers test is the FIRST behavioral exercise of the deadline (the prior 4 synchronous-mock tests never advanced `Date.now()`, so an inverted/deleted check stayed green) — genuine coverage gain. Note: the absolute 10 s ceiling still exceeds LinkedIn's ~3 s (the residual MINOR-3 from cycle-20 critic), but that's a separate, pre-existing tuning question; warm path returns instantly. **Named hole closed.**

### T4 — A2 stale comments — FIXED. (confidence HIGH)
Both search routes now point at `lib/search-enrichment-fields.ts`. Trivial, correct.

### T6 — bounded-map `.data` live-ref doc — ADEQUATE (doc-only is right). (confidence HIGH)
`bounded-map.ts:49–63` documents the live-ref caveat AND names the exact future trap (upload-tracker window-reset migration). I confirmed there is NO live `.data` mutator across `rate-limit.ts` / `auth-rate-limit.ts` / `actions/public.ts` (grep empty), so doc-warning (not copy-on-read) is the correct, allocation-preserving choice. The LATENT-1 trap from cycle-19 is now visible-before-springing.

### T7 — doc-gap closures — ACCURATE, but the sweep itself left one gap. (confidence HIGH)
The three added Key-Files rows (og-photo-fetch / color-label / search-enrichment-fields) and the two column edits (`has_gain_map` +`infe`, new `was_downscaled` row) all match the code. No NEW drift introduced. But the doc-gap pass missed CRIT21-02 (below) — the same class it was closing.

---

## MAJOR

### CRIT21-01 — Focus-visible: the scanner is at its OWN committed deadline AND T3 left ~14 siblings unfixed. (confidence HIGH; realist-rated MAJOR-as-process, not a shipped a11y defect)
**Evidence (the loop's signature failure, reproduced):** I ran a source scan for styled `<Link>/<a>/<button>` (carrying `hover:`/`active:`/`aria-current`) that lack `focus-visible:`. After verifying every hit by reading source (and discarding 2 false positives at `lightbox.tsx:615/636`, where the ring is correctly painted on an inner `<span>` via `group-focus-visible:` — the R19C19 D19-01 pattern my regex truncated at the button's first `>`), the genuine siblings are:
- Public: `footer.tsx:43` (GitHub link), `footer.tsx:52` (admin link), `on-this-day-widget.tsx:40` ("View Timeline"), `home-client.tsx:459`, `topic-empty-state.tsx:18`, `s/[key]/page.tsx:105`, `year/[year]/page.tsx:107`, `info-bottom-sheet.tsx:456`, `photo-viewer.tsx:905`, `not-found.tsx:43`, `error.tsx:38`, `global-error.tsx:78`, `histogram.tsx:720`.
- Admin: `analytics-client.tsx:112/222`, `admin/.../error.tsx:35/41`.
- Ambiguous (likely intentional): `search.tsx:71` is an ARIA `role="option"` whose keyboard indicator is the `bg-muted` active state via `aria-selected`, not a DOM focus ring — probably correct as-is.

T3 hardened exactly 5 files (nav-client, admin-nav, lightbox-color-pip, timeline, g/[key]). The ~14 above are the same designer-targeted class, left for the next pass. This is the THIRD cycle-named pin file (`focus-visible-rings-cycle17/19/20`) for one defect class, and the cycle-20 plan/deferred record explicitly states: *"the broad scanner is COMMITTED for cycle 21 (criterion already met — no further deferral past then)."* So a scanner is contractually due THIS cycle; shipping pin file #4 instead would be textbook churn.

**Realist Check (severity recalibration):** NONE of the ~14 siblings set `outline-none`/`focus:outline-none`, so they all retain the browser-default focus outline ⇒ they are NOT WCAG 2.4.7 failures; they are custom-ring visual-consistency gaps (matching the designer's MED/LOW framing). The only `outline-none`-without-replacement hits were the two `lightbox.tsx` false positives, which are actually fine. So: **no shipped accessibility defect** — this is MAJOR purely as a *process/structural* signal (overdue root fix + demonstrable per-pin leakage), not a user-facing break. *Mitigated by:* UA default focus ring renders on every one of these controls today.
**Why it matters:** the per-pin test asserts only `≥N matches of focus-visible:ring-ring per file` — it structurally CANNOT catch a newly-added link with no ring. The coverage is illusory; the leak will recur every cycle a new styled link lands.
**Recommendation (NOW — it's due):** build a CONSERVATIVE scanner (interactive `<Link href>/<a href>/<button>` in nav components + the public route group that carry `hover:`/`active:` styling, no `focus-visible:`, no `group-focus-visible:` ancestor, no exempt marker), seeded `KNOWN_VIOLATIONS`-style like `touch-target-audit.test.ts` — and CRUCIALLY teach it the two false-positive shapes I hit (group-focus-visible on a child; UA-default-is-acceptable when `outline-none` is absent), or it will be noisy (which is the legitimate reason the loop has hesitated — CLAUDE.md notes the touch-target scanner took many cycles to stabilize). If the conservative scanner is too noisy to land cleanly, fix the ~14 concrete siblings this cycle and DO NOT add pin file #4 — pin files 17/19/20 should be collapsed into the scanner, not extended.

---

## MINOR

### CRIT21-02 — T7 doc sweep missed a real doc-code drift: `SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX` are documented as env-tunable but are hardcoded constants. (NOW-ACTIONABLE, confidence HIGH)
CLAUDE.md (Operational Playbook → "Runtime limits") describes `SEMANTIC_SCAN_LIMIT` *(default 2000)* and `SEMANTIC_TOP_K_MAX` *(default 50)* in the same `name (default X)` notation used for genuine env vars, implying an operator can set them in `.env.local`. But the code defines them as plain `export const SEMANTIC_TOP_K_DEFAULT = 20; SEMANTIC_TOP_K_MAX = 50; SEMANTIC_SCAN_LIMIT = 2000;` in `lib/clip-embeddings.ts:16–18` with NO `process.env` read anywhere (I grepped — zero numeric/env references to either name beyond the const + usage at `semantic/route.ts:92`). An operator who sets `SEMANTIC_SCAN_LIMIT=5000` gets silent no-op. Pre-existing (not a cycle-20 regression), but T7's whole purpose was closing doc-code gaps and this is the same class. **Fix:** either wire the two as `Number(process.env.…)`-parsed (matching the T1 precedent, with finite/positive guards) OR correct the doc to call them compile-time constants. LOW: defaults are sensible; never caused an incident.

### CRIT21-03 — A3 single-settle: deferral is policy-compliant this cycle, but it is the 4th cycle and wants the hard-trigger discipline. (STRUCTURAL/DEFER, confidence HIGH)
I verified the exit criterion is UNMET: the 6 settle sites are unchanged at `images.ts:244/249/273/277/542/564` and T1's only `images.ts` edit was at `:797` (inside `deleteImages`, NOT between the upload claim and settle). So no new `await` landed in `uploadImages` and the deferral is correct per the recorded rule. BUT the trajectory is the focus-visible pattern applied to control flow: cycles 16/17 added settle sites, 18 documented the comment-only invariant, 19 deferred, 20 deferred (E1). The cycle-20 critic's MAJOR-1 (implement the idempotent settle-in-`finally`; the `finally` at `:590` already exists) remains the clean root fix. **Recommendation:** keep deferred ONLY under the hard trigger already recorded ("next new `await` between claim and settle, OR a fresh leak instance") — and when that fires, implement, do not add settle site #7. No symptomatic patching past this point.

### CRIT21-04 — T1 `Math.floor` asymmetry. (confidence HIGH; NON-ACTIONABLE by realist check)
Only `upload-limits.ts:11` wraps `Math.floor(Number(...))`; `audit.ts`, `process-image.ts` (×3), `images.ts` cleanup, and `rate-limit.ts` use bare `Number(...)`. A fractional operator input (e.g. `IMAGE_CLEANUP_CONCURRENCY=5.5` ⇒ loop step `i += 5.5`; `IMAGE_MAX_INPUT_PIXELS=1.5e8` ⇒ fractional pixel cap) is benign — `Array.slice` truncates, Sharp thresholds tolerate floats, and the inputs are operator typos. *Mitigated by:* no real-world fractional values; behavior is correct for every integer/scientific input. Noted only so a future reader doesn't mistake the asymmetry for an oversight worth "fixing" with churn.

---

## What's Missing / Latent

### LATENT-1 — The per-cycle pin-test pattern is itself accumulating cruft and giving false coverage confidence.
`focus-visible-rings-cycle17.test.ts` (167 lines), `-cycle19.test.ts` (81), `-cycle20.test.ts` (63) all test ONE defect class with loose `expect(src).toContain('focus-visible:ring-ring')` / `match(...).length >= N` assertions. None can catch a NEW unfixed control — they only lock the specific files already fixed. Three cycle-named files for one invariant is the same "fix one sibling, add a pin, miss the next" loop the scanner is meant to end. When the scanner lands (CRIT21-01), these three should be SUBSUMED, not left as dead weight alongside it.

### LATENT-2 — `search.tsx:71` listbox option: confirm the active-state-as-focus-indicator is intentional before the scanner flags it.
The combobox `role="option"` link uses `bg-muted` for the `aria-selected` active row and has no focus ring. In the aria-activedescendant pattern the option never receives real DOM focus (the input keeps it), so a focus-visible ring would be inert and the `bg-muted` IS the correct indicator. A naive scanner WILL flag this — so the scanner's exempt logic must recognise `role="option"`/`aria-selected` rows, or this becomes a permanent false positive. Flagging so the scanner author handles it deliberately rather than papering it with an inline exempt comment.

---

## Deferred exit-criteria re-decision (the explicit ask)
- **focus-visible scanner (MAJOR-2):** exit criterion MET and the deferral record itself says cycle 21 is the no-further-deferral point. **DUE NOW** — see CRIT21-01.
- **A1 (topics.slug fan-out):** UNMET. No schema change in cycle-20; still exactly 3 FK children + the 1 non-FK `smart_collections.query_json`. Keep deferred. (Cycle-20 critic's widen-the-criterion-to-2nd-non-FK-referrer suggestion is still worth recording.)
- **A3 (upload single-settle):** UNMET (verified — settle sites unchanged, no new await). Deferral compliant; see CRIT21-03 for the discipline ask.
- **A4 / A5 / A6 / N1 / N2 / PERF-C20-*:** no triggering change in cycle-20; all UNMET. Keep deferred.

## Loop-value verdict (the explicit ask): NET POSITIVE this cycle, but the high-value structural item was deferred to its own deadline — watch for churn next.
Real value: **T1** (two genuine MEDIUM correctness/data-retention bugs — `1e3`-day audit purge, `256e6`-px upload lockout — swept completely with a non-vacuous test) and **T5** (a real cold-path latency bound PLUS the first behavioral deadline test where there was none). **T2** is correct but marginal (negligible incidence; defense-in-depth). **T3/T4/T6/T7** are cosmetic/comment/doc polish. That mix is acceptable for a mature repo, but the signal to watch: the ONE high-leverage structural fix available (the focus-visible scanner) was deferred to its committed deadline, which is now. If cycle 21 ships another docs/cosmetic batch and adds pin file #4 instead of the scanner, that crosses from "diminishing returns" into "churn." The cheap-and-correct fixes are real; the loop's remaining value is concentrated in finishing the 2–3 structural roots (scanner, A3) it keeps circling — not in another lap of sibling-pins.

## Multi-perspective notes
- **Skeptic:** cycle-20's fixes are real, but the cycle re-ran the loop's own diagnosed failure mode (T3 fixed 5 of ~19 styled links) while the documented cure (scanner) sat deferred — and the doc-gap sweep (T7) itself missed a doc-gap (SEMANTIC limits). The pattern isn't in the code anymore so much as in the *process*: each pass closes the exact reported symptom and re-defers the root.
- **Executor:** the two likeliest future trip points remain comment-or-pin-only: adding a styled `<Link>` without the ring (no scanner to catch it) and adding an `await` in `uploadImages` without a settle (no structural single-settle). Both are exactly the CRIT21-01 / CRIT21-03 roots.
- **Stakeholder:** the correctness-sensitive fixes (T1 data-retention/upload, T2 privacy) are solid and tested; zero user-facing regression. The reservations are process/maintainability, not shipped defects.

## Verdict justification
ACCEPT-WITH-RESERVATIONS. Gates green (typecheck 0; vitest 2168/4; 3 lint gates PASS). Every T1–T7 deliverable verified correct, complete-where-claimed, and tested. The single MAJOR (CRIT21-01) is a process/structural item: the focus-visible scanner is at its committed cycle-21 deadline and a concrete ~14-sibling backlog proves the per-pin approach still leaks — but the Realist Check downgrades it from a candidate-CRITICAL (potential WCAG) to MAJOR-as-process because none of those siblings actually remove the UA focus ring (no shipped a11y defect). The MINORs are one missed doc-drift (CRIT21-02, now-actionable, cheap) and the A3 discipline note (CRIT21-03, defer-compliant). Upgrade to ACCEPT when the conservative focus-visible scanner lands (collapsing pins 17/19/20) and CRIT21-02 is corrected.

## Open Questions (unscored)
- Is the OG 10 s absolute ceiling ever actually reached behind the single-instance localhost fetch, or is the real cold-path failure an instant 404 (already fast)? One prod observation would settle whether the residual MINOR-3 ceiling is worth lowering or is theoretical (carried from cycle-20).
- Should `SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX` actually BE env-tunable (the doc clearly assumed so)? If yes, CRIT21-02's fix is "wire the env read"; if no, it's "correct the doc." The product intent decides direction.
