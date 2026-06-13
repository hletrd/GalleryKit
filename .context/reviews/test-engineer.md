# Test-Engineer Review — Cycle 8 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `9c40d261` (working tree clean at start)
**Suite baseline measured live this cycle:** `npx vitest run` → **exit 0, 219 files / 2093 tests passed, 0 failed** (COLD run, 288.93 s; the documented libheif cold-flake did NOT reproduce). Count grew 2086 → 2093 (+7), matching the cycle-7 additions.

## Bottom line

After seven cycles of heavy test-depth hardening the suite is in very good shape. I verified the three cycle-7 closures are **non-vacuous** (each goes RED on the exact regression it guards), confirmed the privacy/security boundary tests are model-quality, and swept the correctness-critical lib surface. I found **one** genuine, high-value, verifiable coverage gap (TE8-01, share-key modulo-bias), plus **one** low-value structural-mirror observation (TE8-02). No flaky tests beyond the already-tracked-and-bounded real-encode isolation note (AGG-C7-R7), which did not reproduce. I am deliberately NOT proposing test churn — the rest of the surface does not need additions.

---

## Cycle-7 closures — VERIFIED NON-VACUOUS (do not re-report)

| Prior finding | Closing commit | Verdict |
|---|---|---|
| **AGG-C7-02** WebP XMP-chunk `JUNK`-retag GPS branch had zero direct coverage | `5ef545bf` | **CLOSED, NON-VACUOUS.** `strip-gps-from-original.test.ts:282-333` injects a real spec-shaped `XMP ` RIFF sub-chunk via `injectWebpChunk` (FourCC + LE size + payload + pad, top-level RIFF size fixed). Positive test asserts `stripped:true` + FourCC retagged to `JUNK` + `GPSLatitude` token gone + **VP8 pixel-chunk byte-identity** (`webpPixelChunk(after).equals(webpPixelChunk(before))`). The byte-identity assertion is exactly what a wrong `buf.write('JUNK', offset, …)` offset (the AGG-C6-01 bug class) would break → proven RED-on-regression. Negative test asserts a GPS-free `XMP ` chunk is left intact with the **same buffer reference** returned (`result!.buffer).toBe(withXmp)`). Strong. |
| **AGG-C7-03** Link/a/select touch-target patterns lacked the sub-44 scale-token catch-all | `99071d76` | **CLOSED** (self-check fixtures added; the prior cycle's Node re-proof in the aggregate confirmed the Button catch-all flags the same sources). |
| **AGG-C7-05** WebP lossless re-encode detected via whole-buffer `includes('VP8L')` substring | `85bca582` | **CLOSED, NON-VACUOUS.** `process-image-webp-lossless-detect.test.ts` pins `isLosslessWebpByChunk`: the key test injects an `XMP ` chunk carrying the literal bytes `VP8L`, asserts the **precondition** `withPlantedSubstring.includes('VP8L') === true` (proving the naive scan WOULD have matched), then asserts `isLosslessWebpByChunk(...) === false`. That is the exact regression the fix closes. Plus genuine-lossy/genuine-lossless/malformed cases. Strong. |

---

## FINDINGS

### TE8-01 — `generateBase56` has no modulo-bias / distribution test; a naive `% 56` revert would weaken share-key entropy invisibly  (Severity: LOW-MED · Confidence: High)

**Prod:** `apps/web/src/lib/base56.ts:6-28` — `generateBase56(length)` is the unguessable-token generator for **both** photo-share keys (`sharing.ts:127`, `PHOTO_SHARE_KEY_LENGTH=10`) **and** group-share keys (`sharing.ts:239`, `GROUP_SHARE_KEY_LENGTH=10`). Its security property is **uniform distribution** over the 56-char alphabet, enforced by rejection sampling: `while (randomValue >= 224)` discards the top 32 of 256 byte values so that `randomValue % 56` is unbiased (`256 % 56 = 32`, so without rejection the first 32 alphabet indices would be over-represented).

**Test:** `apps/web/src/__tests__/base56.test.ts:4-23` — the `generateBase56` describe block asserts only three things: (1) output length, (2) every char ∈ `BASE56_CHARS`, (3) two successive calls differ. **None of these pins the distribution.**

**The regression it would miss:** revert the generator to a naive `result += BASE56_CHARS.charAt(pool[i] % 56)` (drop the rejection loop) — a plausible "simplification" edit. Walking the three existing assertions:
- length → still passes (still N chars);
- valid charset → still passes (`% 56` is always a valid index 0-55);
- successive differ → still passes (still random).

So a modulo-bias regression is **completely invisible to the suite.** The impact: with the bias, alphabet indices 0-31 become ~31 % more likely than 32-55, which reduces the effective entropy of the 10-char base-56 share keys and makes share-key enumeration measurably easier — directly weakening the "base-56 share keys are the unguessable-token boundary" property the security review relies on (aggregate VERIFIED-CLEAN, A01).

**Empirically confirmed this is measurable, not theoretical** — I simulated both generators over 560k random bytes (`node -e`):
- Naive `% 56`: char-frequency **max/min ratio = 1.316** (indices 0-31 over-weighted by ~31 %).
- Rejection-sampled (current code): **ratio = 1.057** (≈ uniform; statistical noise only).

The gap between 1.316 and 1.057 is wide and stable, so a tolerance band cleanly separates correct from broken.

**Concrete test to add** (to `base56.test.ts`, in the `generateBase56` describe):
```ts
it('produces a near-uniform character distribution (rejection sampling, not modulo-biased)', () => {
    // Security invariant: generateBase56 is the share-key generator (sharing.ts).
    // 256 % 56 = 32, so a naive `byte % 56` would over-weight the first 32 of
    // the 56 alphabet chars by ~31% — measurably weakening share-key entropy.
    // The rejection loop (reject >= 224) keeps it uniform. This test goes RED
    // on a revert to a naive modulo generator (empirically: biased max/min
    // ratio ~1.32 vs rejection-sampled ~1.06 over this sample size).
    const counts = new Map<string, number>();
    for (const ch of BASE56_CHARS) counts.set(ch, 0);
    const SAMPLES = 200_000; // ~3571 expected hits/char; CV ~1.7%
    const s = generateBase56(SAMPLES);
    for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const freqs = [...counts.values()];
    const lo = Math.min(...freqs), hi = Math.max(...freqs);
    // Correct impl lands ~1.06; biased impl ~1.32. 1.20 is a safe separating band.
    expect(hi / lo).toBeLessThan(1.20);
    expect(lo).toBeGreaterThan(0); // every char must be reachable
});
```
This is a single deterministic-enough test (200k samples → coefficient of variation ≈ 1.7 %, so the correct impl sits far below the 1.20 ceiling with negligible flake risk). It is the one assertion that pins the security-relevant property of the only token generator that lacks one. (`stripe-download-tokens` / session HMAC use `crypto`-native paths already behaviorally tested in `stripe-download-tokens.test.ts` / `session.test.ts`; LR PATs delegate to those — base56 is the lone hand-rolled char generator.)

**Why this rises above "marginal":** it is not a new feature or a style pin — it is the missing regression guard on the entropy of the public share-key surface, the exact kind of property that silently degrades under an innocent refactor and that no other test in the 2093-test suite would catch. Severity is LOW-MED (not High) because the code is correct **today** and the bias would degrade-not-break security; it is a test-depth gap, not a live defect.

### TE8-02 — `map-privacy` runtime GPS-leak guard tests re-implement the guard inline rather than invoking the real predicate  (Severity: LOW · Confidence: Medium · likely DEFER)

**Test:** `apps/web/src/__tests__/map-privacy.test.ts:90-118` — the two "runtime guard rejects/accepts rows" tests hand-rewrite the guard body inside the test (`if (!row.topic_map_visible) throw ...`) instead of calling the actual `getMapImages` row-assertion in `data.ts`. They therefore verify the test author's *copy* of the guard, not the shipped guard — if the real guard's throw condition were inverted or deleted, these two tests would still pass.

**Mitigating context (why this is LOW / likely DEFER):** the *real* protection on the GPS-on-map surface is the **compile-time UNION contract** at `map-privacy.test.ts:58-71` (`publicMapSelectFields == publicSelectFields ∪ {latitude, longitude}`), which IS a genuine guard and DOES go red on drift. `getMapImages` is DB-dependent (a `JOIN` against `topics.map_visible` + a per-row assertion), so a fully behavioral test needs a DB harness the suite intentionally avoids for unit-tier tests. The inline mirror is a reasonable documentation-of-intent stand-in, and the field-set contract already covers the column-leak vector (the higher-stakes one). I would only tighten this if a future refactor moves the runtime predicate into an exported pure helper (then call it directly); as-is it is a known structural-mirror, not a high-value gap. **Disposition: DEFER / record-only.**

---

## VERIFIED WELL-COVERED (stress-tested this cycle, NO action — confirming convergence)

- **Privacy boundary — model-quality.** `privacy-fields.test.ts:83-90` is a *symmetric* guard: `adminOnlyKeys (= adminSelectFields ∖ publicSelectFields)` must `toEqual` the full 22-key `SENSITIVE_KEYS` contract — catches BOTH a sensitive key leaking into public AND a new admin-only column not being declared. `map-privacy.test.ts:58-71` pins the map UNION contract. `data-timeline` mirror pinned (`:101-120`, TEST-R4C9-04). The GPS-byte-scrub at-rest is covered by all 5 `gps-exif-strip` scrubbers (`stripGpsFromJpegBuffer` / `Tiff` / `Isobmff` / `Webp` direct + the shared `stripGpsFromTiffRegion` core), each with positive byte-identity + GPS-gone + negative same-reference passthrough.
- **getClientIp / proxy-hop / IP-spoofing** (`rate-limit.test.ts:102-181`) — thorough: default nearest-trusted-hop, `TRUSTED_PROXY_HOPS` indexing, invalid-hops fallback to 1, **chain-shorter-than-hops → `unknown`** (the spoof-defense case), x-real-ip fallback, untrusted-headers → `unknown`. This is the rate-limit-key integrity surface and it is solid.
- **Migration post-conditions** (`migration-journal-monotonicity.test.ts:97-118`) — pins both the missing-hash predicate logic AND that `migrate.js` still carries the `Drizzle silently skipped` loud-fail throw with the exact `expectedMigrations.filter((m) => !recordedHashes.has(m.hash))` shape. `reconcileLegacySchema` covered by `migrate-reconcile-coverage.test.ts`. The non-monotonic-`when` production-burn scenario is the documented motivation and is guarded; the journal-`when` monotonicity itself is pinned (`:63-96`) with a no-stale-allowlist guard.
- **SW LRU** (`sw-cache.test.ts:95-271`) — eviction-under-cap, evict-oldest, multi-evict-until-under-cap, upsert-timestamp-on-reinsert, and the R4C6 quota-evicted-accounting-parity (browser-already-evicted entries don't count toward `evicted` bytes but their metadata is dropped). `isAdminRoute` / `isImageDerivative` boundary cases pinned. Plus `sw-template-contract.test.ts` pins the shipped template against the reference impl.
- **process-image decision matrix + fail-closed** — `process-image-post-encode-verification.test.ts` fails FAST on NCLX primaries/transfer/matrix mismatch (R28-CP-MED-1), accepts ICC `prof` alternative + oversized-prof box. Decision matrix pinned by `color-pipeline-decision.test.ts` + `process-image-p3-icc.test.ts` + `process-image-icc-options-lockin.test.ts`; detection precedence by `color-detection.test.ts` + `icc-chromaticity.test.ts` + `gain-map-detection.test.ts`. Backfill column-set + detection-failure-no-version-bump pinned for BOTH paths (`backfill-color-pipeline.test.ts` + `admin-backfill-runner-detection-failure.test.ts` + the deleted-mid-reencode variants).
- **Unicode / bidi / CSV-injection sanitizers** — 12 test files reference the `containsUnicodeFormatting` / bidi / Trojan-Source guard (`validation.test.ts`, `csv-escape.test.ts`, `og-sanitize.test.ts`, `sanitize-admin-string.test.ts`, `safe-json-ld.test.ts`, …). The admin-string spoofing surface is well-defended.
- **base56 *validator*** (`isBase56`) — fully covered (charset, excluded `0/1/O/I/l`, exact + array length, non-string). Only the *generator's distribution* is the gap (TE8-01).
- **Server-action auth/origin** — `check-action-origin.test.ts` + `check-api-auth.test.ts` + `check-public-route-rate-limit.test.ts` fixtures scan EVERY action/route file (so settings/sharing/collections/embeddings, which lack dedicated behavioral tests, are still covered for the auth+origin+rate-limit invariants — the highest-stakes contract). Share-key generation entropy is the one piece those fixtures can't assert → TE8-01.

## Flaky-test assessment

- **Real-encode AVIF/WebP shared `public/uploads`** (`process-image-color-roundtrip.test.ts:31-44`, AGG-C4-T2 / AGG-C7-R7) — no per-test `mkdtemp` output isolation. Re-confirmed UNCHANGED and did **not** reproduce on this cold run. Bounded (file-tier tests serialize and the fixtures use distinct names); the documented libheif cold-flake also did not fire. Not escalating — it remains a record-only isolation note, not an active flake.
- No new ordering/timing/shared-state flake observed across the 2093-test cold run.

---

## Summary for orchestrator

| ID | Finding | Severity | Confidence | Disposition |
|---|---|---|---|---|
| **TE8-01** | `generateBase56` has no modulo-bias/distribution test; a naive `%56` revert would weaken share-key entropy with zero test failure (empirically: biased ratio 1.32 vs uniform 1.06). One deterministic distribution test closes it. | **LOW-MED** | **High** | SCHEDULE — single high-value test, the lone unpinned security-relevant property of the share-key generator. |
| **TE8-02** | `map-privacy` runtime-guard tests re-implement the guard inline rather than calling the real `getMapImages` predicate (structural mirror). The compile-time UNION contract is the real protection and is genuine. | **LOW** | **Medium** | DEFER / record-only. |

**Cycle-7 closures AGG-C7-02 / AGG-C7-03 / AGG-C7-05 all re-verified NON-VACUOUS — not re-reported.** No flaky test beyond the bounded, non-reproducing real-encode isolation note. The suite is converged; TE8-01 is the only addition worth making.
