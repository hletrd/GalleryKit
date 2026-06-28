# Cycle 22 — Critic Review (skeptical, multi-perspective)

**Reviewer:** critic (Opus, read-only)
**HEAD reviewed:** 6ef2495d (cycle-21 T1–T6 + SW stamp + gitignore chore landed)
**Scope:** skeptical verification of the cycle-21 change surface (T1–T6), doc-code mismatches, deferred-list challenge, recurring-pattern hunt.

## VERDICT: ACCEPT-WITH-RESERVATIONS

The six cycle-21 tasks are correctly implemented, tested, and committed; all targeted tests pass (58/58 across the 5 cycle-21 test files when run from `apps/web`), docs match code. **One reservation gates a clean ACCEPT:** the new durable focus-visible scanner (T1b — the cycle's headline artifact) has a scan-root coverage hole and already missed a real sibling on cycle 1 (`app/global-error.tsx:78`), reintroducing the exact "fix one sibling, miss the next" failure mode it was built to kill. Plus one VERY-LOW fractional-floor edge in T4. Neither blocks; both should land in cycle 22.

## Pre-commitment predictions vs reality
- **Predicted:** the new scanner (T1b) is the highest-risk artifact; likely blind spots in scope/heuristic. **Confirmed** — scan-root hole at the non-locale `app/` root (global-error.tsx).
- **Predicted:** T4 `Math.floor` on a `0<n<1` fractional yields 0. **Confirmed** — latent, untested, VERY LOW.
- **Predicted:** remaining `parseInt` on user-input route params (og/photo, similar). **Refuted** — both are regex-fenced (`/^\d+$/`) before parseInt; false positive, retracted.
- **Predicted:** doc-code mismatches in T6 edits. **Refuted** — all four T6 doc edits verified accurate against code.

---

## MAJOR Findings

### M1 — The durable focus-visible scanner has a scan-root hole and missed a real sibling on cycle 1: `app/global-error.tsx:78`
- **Confidence:** HIGH
- **Evidence:**
  - Scanner roots: `focus-visible-links-scan.test.ts:38-41` → `SCAN_ROOTS = [components/, app/[locale]/]`.
  - The missed sibling: `app/global-error.tsx:78-84` is a raw `<button onClick={reset}>` with `className="… transition-colors hover:bg-primary/90"` and **no `focus-visible:` ring, no `outline-none`**. It carries the exact `hover:` interactive signal the scanner keys on, but lives at `app/global-error.tsx` — **outside `app/[locale]/`**, so the scanner never walks it.
  - Bounded: a full `src/` grep confirms `global-error.tsx` is the *only* hover-styled interactive element outside the two scan roots — so the hole is exactly one file today, but it is a *framework-mandated* file class (Next.js root error boundary lives outside the `[locale]` segment by design).
- **Why this matters:** T1b is the cycle's committed headline ("a NEW uncovered interactive Link/a/button fails CI… the durable net so the manual sweep doesn't have to converge"). That promise is materially false for any non-locale `app/` root file. On its very first cycle the net already has a hole at a known, mandatory framework file — the repo's signature "miss the next" pattern landing *inside* the artifact built to prevent it. A reviewer signing off "the scanner now durably prevents focus-ring drift" would be wrong.
- **Realist check:** the *runtime a11y* impact of the one concrete instance is cosmetic/LOW — no `outline-none`, so the UA-default focus ring still renders (same calibration the critic applied to the 20 siblings just fixed), and the global error boundary is rarely hit. The MAJOR rating is for the *structural* coverage gap in the headline deliverable, not the cosmetic instance. Mitigated-by: UA ring still visible; single file affected today.
- **Fix (2 lines + 1 scope line):**
  1. Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the `global-error.tsx:81` button className.
  2. Extend `SCAN_ROOTS` to also cover the non-locale `app/` root boundary files (e.g. add `path.resolve(srcRoot, 'app')` with the existing `.tsx` predicate, or explicitly include `app/global-error.tsx`). Note: the touch-target audit shares the same blind spot but is moot there (the button is `min-h-11`); fixing the focus scanner's scope is the durable closure.

---

## MINOR Findings

### m1 — T4 `envPositiveInt` fractional `0<n<1` → 0 (untested edge, inconsistent with literal-0 fallback)
- **Confidence:** HIGH (logic), **severity VERY LOW** (no realistic operator input).
- **Evidence:** `clip-embeddings.ts` `envPositiveInt`: `Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback`. For `SEMANTIC_SCAN_LIMIT='0.5'`: `Number('0.5')=0.5`, passes `>0`, returns `Math.floor(0.5)=0` → `SEMANTIC_SCAN_LIMIT=0` (scan zero rows → semantic search returns nothing). Yet the literal `'0'` correctly falls back to 2000 (test `clip-semantic-limits-env.test.ts:55`). So `0`→2000 but `0.5`→0 — inconsistent. The test covers `25.9→25` (floor) but not the sub-1 case.
- **Why minor:** no operator sets a fractional sub-1 scan/top-k cap; the same un-guarded pattern already ships in `process-image.ts:47` SHARP_CONCURRENCY (which doesn't floor at all). Not a regression.
- **Fix (optional):** guard the floored result, not the raw input — `const v = Math.floor(n); return Number.isFinite(n) && v > 0 ? v : fallback;` — and add a `'0.5'→fallback` test case.

---

## Verified-correct (no finding)
- **T1a (20 siblings):** real — 13 designer D21 + 7 scanner-discovered (histogram cycle button, info-bottom-sheet/photo-viewer GPS links, 2 analytics links). Lightbox prev/next correctly left ring-free (group-focus-visible child).
- **T1b scanner heuristic quality (within its scope):** GOOD. Case-sensitive `<button` excludes shadcn `<Button>` (self-check L242); `a\b` excludes `<article>/<aside>/<audio>`; `group-focus-visible:` parent handled via a 12-line look-ahead window (self-checks L254-261); multi-line normalization mirrors touch-target-audit (self-check L250); `role="option"` excluded. The `hover:`-gated heuristic *intentionally* will not flag a plain `onClick` button with no hover styling — documented limitation in the test header, accurate `it()` naming ("every *hover-styled*…"), no false claim. Acceptable as a heuristic net (consistent with the repo's other heuristic scanners). Only the scan-*root* scope is wrong (M1).
- **T2 (topics order):** correct. `orderStr = formData.get('order')?.toString() ?? ''` is null-safe; `Number()` + `!Number.isFinite` guard rejects `'1e3'`→1 mis-parse and `Infinity`. `Number('0x10')=16` (was 0) is now accepted but clamped to [-1000,1000] and admin-controlled — a strictness *improvement*, non-issue. Both createTopic + updateTopic patched.
- **T3 (viewCountRetryCount):** correct + meaningful. The post-flush eviction loop (`data.ts:163-176`) now drops the retry counter alongside the buffer entry. All other delete sites accounted for (L125 success, L134 max-retries, L146 drop-path, L172 new, L193 empty-clear, L195-211 cap). The fix is reachable (loop leaves buffer at MAX>0, so L193 clear does not subsume it).
- **T5 (IMAGE_MAX_INPUT_PIXELS_TOPIC test):** passes from correct cwd (`vi.resetModules()` + sharp-mock). Earlier "failures" I saw were stale `.next/standalone/**` test copies collected when run from repo root — a cwd artifact, NOT real failures.
- **T6 (docs):** all four edits verified against code. `withTopicRouteMutationLock` does wrap createTopic (L140), updateTopic (L250), createTopicAlias (L490). SHARP_CONCURRENCY default formula in the doc (`max(1, floor((cpuCount-1)/3))`) matches `process-image.ts:44`; the explicit-value cap (`cpuCount-1`) matches L48. Admin-only labels + lock-scope-note edits accurate.
- **Two route-param `parseInt` (false positive, retracted):** `api/og/photo/[id]/route.tsx:55` and `api/search/similar/[id]/route.ts:78` are both preceded by a strict `/^\d+$/` digit-only guard (L51 / L75), so `'1e3'`/`'42abc'` never reach parseInt — parseInt and Number are equivalent there. The aggregate's "user-input parse sweep complete" claim holds.

## Deferred-list challenge (nothing wrongly deferred)
Walked every deferred row. All are scale-gated/structural/cosmetic with documented exit criteria verified UNMET: A1 topics.slug cascade (best-fenced, 3 FK + 1 JSON referrer, all test-pinned), A3 upload single-settle (0 new awaits in span), A4 restore-maintenance scale-out (fenced by the single-web-instance topology prohibition), A5 storage dead-module (CI quarantine tripwire intact), A6/N2 data.ts cohesion (type-only import, ARCH21-01 correction sound), N1 privacy union (additive-bidirectional caveat correct), the PERF items (445-embedding corpus ≪ 2000 scan cap), SEC-19-01/02 (defense-in-depth LOWs, nginx edge throttle mitigates), TRACE21-05-LOW (crash-fast, not auth bypass). **No data-loss/security item is hiding behind a scale gate.** The privacy `_SensitiveKeysInPublic` guard holds (tsc green). I did not find a deferred item that is secretly CRIT/HIGH.

## Multi-perspective notes
- **As EXECUTOR:** every T1–T6 change is self-contained and committed atomically; the M1 fix is a clean 2-line + 1-scope-line follow-up.
- **As STAKEHOLDER:** the cycle's stated goal — close the focus-visible convergence problem durably — is *almost* met; M1 is the gap between "scanner exists" and "scanner is complete."
- **As SKEPTIC:** the strongest case against ACCEPT is M1 (headline artifact incomplete on day 1). It does not rise to REJECT because the runtime impact is cosmetic and the fix is trivial — but it MUST be the first cycle-22 IMPLEMENT item, or the "scanner converged the manual sweep" narrative is overstated.

## What would upgrade to ACCEPT
Land M1 (ring on `global-error.tsx` + extend `SCAN_ROOTS` to the non-locale `app/` root) and optionally m1 (fractional-floor guard + test). Then the durable-scanner claim is actually true and the cycle is clean.

## Open Questions (unscored)
- Are there future-planned root-level boundary files (`app/error.tsx`, `app/not-found.tsx` at the non-locale root) that would also escape the scanner? Today only `global-error.tsx` exists at that level; worth a one-time SCAN_ROOTS audit when M1 is fixed.
