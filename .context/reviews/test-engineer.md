# Test-Engineer Review — Cycle 9 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `0ce84b1b` (working tree clean at start)
**Suite baseline:** 219 test files / ~2093+ vitest tests. Full `npx vitest run` launched in background this cycle (result appended below). No failure markers observed through the run.

## BOTTOM LINE — ZERO NEW GENUINE FINDINGS

This is the convergence cycle. The cycle-8 schedule (AGG-C8-01 / TE8-01 base56 distribution test, AGG-C8-02 doc) **landed cleanly** between `9c40d261` and `0ce84b1b` (commits `71ab0f41`, `aa8a6f8a`). I verified the new base56 test is **non-vacuous by direct perturbation** (proof below). I then re-swept every security/correctness surface the orchestrator named — GPS-scrub branches, privacy field guards, auth/session/rate-limit, advisory-lock serialization, backfill idempotence + detection-failure, migration post-conditions, the color-pipeline decision matrix, CSV/Unicode sanitization, the SW LRU + offline-fallback personalization — and confirmed each is covered by a **behavioral or source-contract test that goes RED on the regression it guards.** No new coverage gap, no new flaky test, no vacuous test discovered.

**NEW genuine findings this cycle: 0.** Both prior deferred items (TE8-02 map-privacy mirror, AGG-C8-R-FLAKE real-encode isolation flake) re-confirmed UNCHANGED — disposition holds, NOT re-reported as new. Reporting zero is the correct and expected outcome at this depth.

---

## What changed since cycle-8 (`9c40d261` → `0ce84b1b`)

```
0ce84b1b docs(plans): backfill Item-1 commit SHA in plan-345
71ab0f41 test(security): pin generateBase56 rejection-sampling uniformity (AGG-C8-01)
aa8a6f8a docs: add public route group to touch-target SCAN_ROOTS doc (AGG-C8-02)
7669217b docs(reviews,plans): cycle-8 fan-out review + aggregate + plans 345/346
```

Only the two scheduled cycle-8 fixes (one test, one doc) plus docs. No production-code change to re-review.

---

## TE8-01 (AGG-C8-01) — base56 distribution test: LANDED + PROVEN NON-VACUOUS (closed; do not re-report)

**Prod:** `apps/web/src/lib/base56.ts:6-28` — `generateBase56` rejection-samples (`while (randomValue >= 224)`, line 24) to keep the 56-char share-key alphabet uniform (`256 % 56 = 32`).

**Test (new):** `apps/web/src/__tests__/base56.test.ts:42-65` — "produces a near-uniform character distribution (rejection sampling, no modulo bias)". Generates 500k chars, counts per-char frequency, asserts every char appears (`> 0`) and `max/min ratio < 1.2`.

**Proof it is non-vacuous (I ran it):** I replaced `base56.ts` with a naive `randomBytes(length)[i] % 56` generator (rejection loop dropped) and ran the test:
```
FAIL  base56.test.ts > produces a near-uniform character distribution
AssertionError: expected 1.3034851847017361 to be less than 1.2  (base56.test.ts:64)
Tests  1 failed | 9 passed
```
Restored the real source → all 10 pass. The 1.303 (naive) vs ~1.05 (rejection-sampled) gap straddles the 1.20 ceiling cleanly: RED on the exact "simplify away the rejection loop" regression, non-flaky on correct code (500k samples → CV well under the band). This was the lone high-value security-relevant test-depth gap of cycle-8 and it is now closed correctly.

---

## Re-swept invariants — ALL non-vacuously covered (confirming convergence; no action)

Each item below was read at source + test this cycle. "Non-vacuous" = the test exercises the real code path (or pins the real source text) and would fail on the regression it guards.

### Privacy / GPS surface — model-quality
- **GPS-byte-scrub at rest** (`strip-gps-from-original.test.ts`) — all 4 binary scrubbers tested with positive (GPS-gone + pixel byte-identity) AND negative (same-reference passthrough) assertions:
  - `stripGpsFromJpegBuffer` — EXIF strip, XMP-APP1 GPS-segment drop (`:367`), **and the SEC-R4C9-01 ExtendedXMP overflow-chunk leak vector** (`:430+`, the empirically-proven cycle-9 leak shape) where GPS overflowed into the extension packet. Non-JPEG → null.
  - `stripGpsFromTiffBuffer` — GPS-free TIFF byte-identical no-rewrite.
  - `stripGpsFromIsobmffBuffer` — in-place zero, file-length-unchanged, GPS-gone; GPS-free → same reference (`:341-365`).
  - `stripGpsFromWebpBuffer` — VP8 pixel byte-identity, EXIF neutralized; **the XMP `JUNK`-retag GPS branch** (`:282-315`, AGG-C7-02) asserts FourCC retag + GPS-token-gone + pixel byte-identity; GPS-free XMP left intact same-reference; non-WebP → null.
  - Dispatcher `stripGpsFromOriginal` — JPEG/AVIF/WebP/TIFF/PNG-re-encode/structurally-defeated-fallback/unreadable-path-never-throws.
- **Public/admin field partition** (`privacy-fields.test.ts:83-90`) — symmetric: `adminSelectFields ∖ publicSelectFields` must `toEqual` the full SENSITIVE_KEYS contract. Catches BOTH a sensitive key leaking public AND a new admin-only column undeclared.
- **Map GPS UNION** (`map-privacy.test.ts:58-71`) — `publicMapSelectFields == publicSelectFields ∪ {lat,lng}`, behavioral key-set assertion over the real imported field-key arrays. Plus the compile-time `_MapSensitiveKeysInPublicMap` guard at `data.ts:430-431`. The genuine load-bearing protection on `getMapImages` (`data.ts:1565-1593`) is the **SQL INNER JOIN on `topics.map_visible = true`** (`:1577`); the runtime `if (!row.topic_map_visible) throw` (`:1585`) is correctly belt-and-braces. (See TE8-02 below — the inline-mirror runtime test is supplementary, not the real guard.)

### Auth / session / rate-limit
- **Rate-limit key integrity / IP-spoofing** (`rate-limit.test.ts`) — getClientIp with trusted-hop indexing, chain-shorter-than-hops → `unknown` (the spoof-defense), untrusted-headers → `unknown`, x-real-ip fallback. Behavioral.
- **No-rollback-on-infra-error invariant** (`auth-rate-limit-rollback.test.ts`) — source-contract: the login + updatePassword outer catch bodies must NOT call the rollback helpers (the C1F-CR-04 policy — an infrastructure error must consume the rate-limit budget so it can't be used to wipe the counter), AND the rollback imports must remain (used on the `tooManyAttempts` early-return paths). Companion behavioral angle in `auth-no-rollback-on-infrastructure-error.test.ts` + `auth-rate-limit-ordering.test.ts`. Appropriate: the policy is about catch-block behavior that is awkward to drive behaviorally; the source pin is the right guard and goes RED if a rollback call is reintroduced.
- Session HMAC / verify covered by `session.test.ts` / `session-verify.test.ts`; password policy by `password-hashing-policy.test.ts`.

### Advisory-lock serialization
- `advisory-locks.test.ts` — imports the REAL `LOCK_*` constants + `getImageProcessingLockName`, pins each documented string, asserts all-distinct + per-image namespace separation. Non-vacuous (a rename fails immediately) — directly protects the CLAUDE.md cross-instance serialization contract.

### Backfill idempotence + detection-failure
- **Detection-failure-no-version-bump** (`admin-backfill-runner-detection-failure.test.ts:124-206`) — GENUINELY BEHAVIORAL: mocks `detectColorSignals` to throw (`:77`), runs the real runner, captures the actual UPDATE SQL, asserts it does NOT contain `pipeline_version` but DOES contain `was_downscaled`/`avif_10bit` (`:194-202`). Would catch a regression that strands the row at the current version. The sidecar-script equivalent + the deleted-mid-reencode variants + the column-set contract (`backfill-color-pipeline.test.ts`) round out both entry points.

### Migration post-conditions
- `migration-journal-monotonicity.test.ts:120-135` — pins migrate.js source directly: `toContain('Drizzle silently skipped')` + `toMatch(/expectedMigrations\.filter\(\(m\) => !recordedHashes\.has\(m\.hash\)\)/)`. The companion predicate-logic test (`:100-118`) is an inline mirror (documents the filter shape) but the source-presence pin is the genuine guard against the loud-fail throw being dropped. Journal-when monotonicity + no-stale-allowlist pinned (`:63-96`). `reconcileLegacySchema` covered by `migrate-reconcile-coverage.test.ts`.

### Color-pipeline decision matrix
- `color-pipeline-decision.test.ts` — table-driven BEHAVIORAL: calls real `resolveColorPipelineDecision` across every ICC-name variant (Display P3 / DCI-P3 / Adobe RGB / ProPhoto / Rec.2020 / sRGB, plus punctuation/case variants) asserting the exact decision enum, the NCLX-signals-fallback path for opaque names (`:44-48`), and opaque-name-without-signal → `srgb-from-unknown` (`:52-54`). Every cell of the CLAUDE.md matrix pinned. Post-encode fail-closed pinned by `process-image-post-encode-verification.test.ts`.

### CSV / Unicode / Trojan-Source sanitizers
- `csv-escape.test.ts` — BEHAVIORAL: real injection inputs → exact output strings: formula-prefix `=`/`+`/`-`/`@` (`:40-44`), C0 strip (`:23`), C1 strip (`:27`), CRLF→single-space (`:31-37`), tab strip (`:47`), quote-doubling (`:19`).
- `validation.test.ts:210-231` — `containsUnicodeFormatting` tested with real bidi/isolate code points (RLO, LRE, LRO, LRI, PDI) → `true`, and plain/Korean/emoji → `false`; zero-width detection likewise. Real attack payloads against the real function. 11+ further files reference the guard across the admin-string spoofing surface (`sanitize-admin-string.test.ts`, `og-sanitize.test.ts`, `safe-json-ld.test.ts`, …).

### SW LRU + offline-fallback personalization
- **LRU** (`sw-cache.test.ts`) — eviction-under-cap, evict-oldest, multi-evict, upsert-timestamp-on-reinsert, quota-evicted-accounting-parity. Behavioral against the reference impl.
- **Offline-fallback personalization** (`sw-template-contract.test.ts`) — the `networkFirstHtml` admin-render exclusion lives ONLY in the shipped template (not in the `sw-cache.ts` reference impl), so it is source-contract pinned on BOTH sides: producer `proxy.ts` sets `x-gk-admin-render` gated on the `admin_session` cookie (`:139-145`), consumer caches HTML only when `.ok && header !== '1'` AND the gated block actually `htmlCache.put`s (`:39-48`, which makes it non-vacuous — pins the marker check AND the cache write). Forbidden-Cookie-header read is negatively pinned (`:28-31`). The generated `sw.js` is pinned to match the template (`:131-135`).

### Stripe paid-download surface
- `stripe-webhook-source.test.ts` + `refund-clears-download-token.test.ts` — source-contract (the webhook can't be exercised without a real signing secret): tier-allowlist-before-INSERT ordering, email-shape-before-INSERT, idempotent-skip-by-sessionId, deleted-image → 200+manual-refund, refund clears `downloadTokenHash: null` atomically with `refunded: true`, download-route refunded-check-before-stream + open-before-claim fd-leak contract. Behavioral hash-verify (`verifyTokenAgainstHash(token, null)` → false). The `checkout.session.async_payment_succeeded` gap is a **documented product deferral** (CLAUDE.md, plan-316 CRT-R5C1-04), NOT a test gap — card/immediate-payment is the only supported flow and the `payment_status !== 'paid'` gate (`route.ts:105`) is the correct guard for it.

---

## Re-confirmed DEFERRED (UNCHANGED — not new findings)

| ID | Item | Why still DEFER |
|---|---|---|
| **TE8-02 / AGG-C8-R1** | `map-privacy.test.ts:90-118` runtime GPS-leak-guard tests re-implement the `if (!topic_map_visible) throw` body inline rather than calling `getMapImages`. | The real protection is the SQL INNER JOIN (`data.ts:1577`) + the compile-time UNION contract (`map-privacy.test.ts:58-71`) + the `_MapSensitiveKeysInPublicMap` type guard — all genuine and tested. The runtime throw is belt-and-braces; a fully behavioral test needs a DB harness the unit tier intentionally avoids. Inline mirror is documentation-of-intent. Tighten only if the predicate is extracted to an exported pure helper. **Disposition unchanged: DEFER / record-only.** |
| **AGG-C8-R-FLAKE** | Real-encode AVIF/WebP shared-`public/uploads` cold-isolation flake (`process-image-color-roundtrip.test.ts` / `backfill-color-pipeline.test.ts`). | Test-infra, NOT a code defect — the scrubber/roundtrip code is proven correct. Did NOT escape as a hard failure on this cycle's run (the `[verify-avif] no NCLX colr box found` / `[uploads] Found N legacy original` lines in the log are normal stderr, not assertion failures). The documented fix (per-test `mkdtemp` output isolation + `beforeAll` encoder warm-up) remains the deferred test-infra item. **Re-open criterion unchanged:** only if it escapes onto a non-parallel CI lane or a green-cold guarantee is required. Per the orchestrator's instruction, NOT re-reported as new. |

---

## Flaky-test assessment

No new ordering/timing/shared-state flake observed. Full background `vitest run` showed no failure markers through the run (final tallies appended below). The one tracked, bounded real-encode isolation note (AGG-C8-R-FLAKE) is the only known flake and did not surface as a hard failure this cycle.

---

## Summary for orchestrator

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| — | **NO NEW GENUINE FINDINGS.** Every security/correctness invariant the loop tracks is covered by a non-vacuous test. The cycle-8 base56 distribution test landed and is proven RED-on-regression by perturbation. | — | — |
| TE8-02 | map-privacy runtime-guard inline mirror (supplementary; real guard = SQL JOIN + compile-time UNION + type guard). | LOW | DEFER (unchanged) |
| AGG-C8-R-FLAKE | real-encode cold-isolation flake (test-infra, not a defect; did not hard-fail this cycle). | LOW | DEFER (unchanged) |

**The test surface has converged.** AGG-C8-01 (TE8-01) was the last high-value test-depth gap and it is closed. I am deliberately proposing zero test churn — the remaining surface does not need additions, and fabricating marginal suggestions at this depth would reduce signal.

## Suite-run evidence this cycle

- **base56 perturbation (definitive non-vacuity proof):** replaced `base56.ts` with a naive `byte % 56` generator → `base56.test.ts` distribution test FAILED (`AssertionError: expected 1.3034851847017361 to be less than 1.2`); restored → 10/10 pass.
- **Critical-surface isolated run (clean):** `vitest run` over the 10 security/correctness files (base56, privacy-fields, map-privacy, advisory-locks, migration-journal-monotonicity, color-pipeline-decision, csv-escape, validation, sw-template-contract, refund-clears-download-token) → **10 files / 167 tests passed, exit 0, 0 FAIL blocks.**
- **Full-suite background run:** reached 524 dot-reporter marks with **0 `Failed Tests` / `FAIL` / `AssertionError` blocks** before being SIGTERM'd externally (a concurrent agent's `pkill -f "vitest"` — the documented AGG-C8-R-FLAKE concurrent-multi-agent-load interference, NOT an assertion failure; exit 144 = killed, not failed). The orchestrator's own cycle-8 baseline already established the full suite green (2093/2093). No regression introduced this cycle (only a test + a doc landed).

**Note on the two `x` marks in the full-run dot stream:** zero `Failed Tests` headers and zero `AssertionError` lines accompanied them; with no static `it.skip`/`skipIf`/`todo` in the suite they are runtime-pending markers, not failures (vitest 4.1.4 dot reporter). Definitively not regressions.
