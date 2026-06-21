# Critic Review — Run-9 Cycle-2 (HEAD `1ef54aaa`)

**Date:** 2026-06-21
**Role:** Adversarial falsification of the convergence claim, with two explicit mandates: (1) prove the TWO new test files actually pin the right invariants (no false confidence), and (2) adversarially probe the highest-risk subsystems for anything 9 runs missed.
**Mode:** THOROUGH (no escalation — no CRITICAL, no 3+ MAJOR, no systemic pattern).

## VERDICT: ACCEPT — 0 new findings. Convergence confirmed (fourth consecutive convergence).

---

## Convergence premise verified (not trusted)

- `git diff --stat f63af3b9..HEAD -- 'apps/web/src/**'` = **ONLY two new test files** (`upload-tracker-state.test.ts` +140, `upload-processing-contract-lock.test.ts` +146). **Zero production-logic change** since run-8 convergence. [verified]
- Both new test files correspond exactly to the two SCHEDULED findings from run-9 cycle-1 (TE-R9C1-01 MEDIUM, TE-R9C1-02 LOW). They are the *fix* for those findings, landed as pure test additions.

## Gate snapshot (fresh foreground runs at HEAD `1ef54aaa`)

| Gate | Result |
|---|---|
| `npm run typecheck` (app + scripts, 7 JS files) | **exit 0** |
| Full Vitest suite | **2054 passed / 4 skipped / 0 failed** (224 files passed + 2 skipped = 226) |
| New tests in isolation | **18 passed** (2 files) |
| privacy-fields | **8/8 pass** |

The 4 skips are exclusively the CLIP-weight-gated suites (unchanged). File count rose 222→224 = exactly the +2 new test files; test count rose by +18 = exactly the new behavioral cases. No collateral churn.

---

## MANDATE 1 — Are the two new tests sound, or false confidence? -> SOUND (mutation-proven)

I read BOTH test files AND both source modules line-by-line, then ran **mutation-sensitivity checks** to prove the assertions actually discriminate the invariant (a test that passes regardless of source is worthless). All source files were restored + re-verified after each mutation.

### `upload-tracker-state.test.ts` vs `upload-tracker-state.ts`
- **Source `pruneUploadTracker` uses `> WINDOW_MS*2`** (`:39`). Test `:45` (`NOW - 2x - 1` → expired) and `:53` (`NOW - 2x` exactly → kept) pin the strict-`>` boundary.
  - **Mutation:** flipped `>` → `>=` at `:39`. Result: the "keeps an entry exactly AT the 2x boundary" test **FAILED** (1 failed | 10 passed). Non-tautological. [verified, restored]
- **Source `resetUploadTrackerWindowIfExpired` uses `> WINDOW_MS`** (`:63`). Test `:98` (`-1` resets) and `:105` (`=` exactly, untouched) pin it.
  - **Mutation:** flipped `>` → `>=` at `:63`. Result: the "leaves untouched exactly AT the 1x boundary" test **FAILED** (1 failed | 10 passed). Non-tautological. [verified, restored]
- **MAX_KEYS eviction** (`:49-59`, insertion-order, oldest-first): test inserts MAX_KEYS+3 FRESH entries (so expiry is a no-op and only the hard cap fires), asserts size==cap AND k0/k1/k2 evicted, newest survives. Correctly isolates the cap path from the expiry path.
- **`hasActiveUploadClaims`** (`:70-79`, the SOLE settings-race guard at `settings.ts:70`): tests true-on-count>0, true-on-bytes>0, false-on-empty, and the critical false-on-window-expired case (`:129`) — an entry past 1x window but not yet 2x-pruned must be reset-to-zero in place and NOT counted as active. The test verifies BOTH the return value AND the in-place mutation persisted. This is the exact false-negative that would silently drop the `image_sizes`/`strip_gps_on_upload` lock against an in-flight upload. Correctly pinned.

### `upload-processing-contract-lock.test.ts` vs `upload-processing-contract-lock.ts`
- **Source `:32`: `lockAcquired = acquired === 1 || acquired === BigInt(1)`** — the dual-arm guard for mysql2 returning GET_LOCK as `number` OR `BigInt`.
  - **Mutation:** dropped the `|| acquired === BigInt(1)` arm. Result: the dedicated "returns a working lock when GET_LOCK yields BigInt(1) — the defensive arm" test **FAILED** (1 failed | 6 passed). The test genuinely exercises the branch that had never been covered. Non-tautological. [verified via perl, restored]
- **Mock fidelity:** the fake connection's `.query()` returns `[[{ acquired: value }], undefined]` — the correct mysql2 `[rows, fields]` tuple shape that the source destructures at `:27` (`const [lockRows] = await conn.query(...)`) then reads `lockRows[0]?.acquired` at `:31`. The mock matches the real driver contract; it is not a hand-waved stub.
- Non-acquired paths (`0`, `null`), error paths (getConnection throw, post-connect query throw), and release-idempotency (double `release()` issues RELEASE_LOCK once, `:46-47` `released` guard) are all covered and map to real source branches.

**Mandate-1 verdict: the tests are correct, meaningful, and mutation-proven non-tautological. No false confidence. Pre-commitment prediction #1 (false-confidence tests) is REFUTED.**

---

## MANDATE 2 — Adversarial probes of the highest-risk subsystems -> ALL REFUTED

Pre-commitment predictions (made before deep investigation) for where a defect could survive 9 runs:
2. Color/HDR NCLX map has an actual code/comment-vs-standard mismatch in an un-spot-checked entry.
3. A schema admin-only column is missing from one of the 4 privacy-guard layers.
4. An advisory-lock name collision or a leaked connection on a release path.
5. An image-queue claim/UPDATE/cleanup race gap under interleaved delete.

### P2 — NCLX color maps (`color-detection.ts:170-219`) vs ITU-T H.273 -> CLEAN
Verified EVERY mapped transfer + matrix code against the authoritative H.273 table (VapourSynth canonical mapping + ITU-T AAP confirmation, fetched this cycle), not just the entries prior cycles spot-checked:

| Code | H.273 standard | code map | verdict |
|---|---|---|---|
| transfer 1 | BT.709 | `srgb` (documented SDR approx) | ✓ |
| transfer 4 | 470m (System M) | `gamma22` | ✓ |
| transfer 5 | 470bg (PAL/SECAM) | `gamma28` | ✓ (AGG-R7C2-01 fix correct) |
| transfer 6 | 601 | `gamma22` (approx) | ✓ |
| transfer 7 | 240m (SMPTE 240M) | `gamma22` (approx) | ✓ |
| transfer 8 | linear | `linear` | ✓ |
| transfer 11 | xvYCC (61966-2-4) | `srgb` (documented approx) | ✓ |
| transfer 13 | sRGB (61966-2-1) | `srgb` | ✓ |
| transfer 14/15 | BT.2020 10/12-bit | `gamma24` (BT.1886) | ✓ |
| transfer 16 | ST 2084 | `pq` | ✓ |
| transfer 17 | ST 428-1 | `gamma26` (DCI 2.6) | ✓ |
| transfer 18 | std-b67 | `hlg` | ✓ |
| matrix 0/1/8/9/10 | rgb/709/ycgco/2020ncl/2020cl | identity/bt709/ycgco/bt2020-ncl/bt2020-cl | ✓ |

Code 2 ("Unspecified") is correctly OMITTED (no defalt to gamma22 — R5-H1). Primaries map (1/9/11/12) all correct. **Verdict: REFUTED — the maps match the standard exactly; comments are accurate. Prediction #2 refuted.**

### P3 — Privacy-guard layer consistency (`data.ts` + `schema.ts` + `privacy-fields.test.ts`) -> CLEAN
The four layers are SELF-CONSISTENT (not coincidentally aligned):
- `PrivacySensitiveKeys` union (`data.ts:414`) = 20 keys.
- `SENSITIVE_KEYS` fixture (`privacy-fields.test.ts:6-42`) = same 20 keys.
- `publicSelectFields` destructure-omits all 20 (`:323-351`); `publicMapSelectFields` omits the same 20 MINUS lat/long (`:364-387`), and its compile guard auto-derives via `Exclude<PrivacySensitiveKeys, 'latitude'|'longitude'>` (`:427`) — so a NEW union entry is guarded on the map path WITHOUT a manual edit.
- Compile guards `_SensitiveKeysInPublic` (`:416`) and `_MapSensitiveKeysInPublicMap` (`:428`) both resolve to `never` (typecheck exit 0 proves it).
- `avif_10bit` is correctly PUBLIC: present in `adminSelectFields` (`:275`), RETAINED in `publicSelectFields` (not omitted), and correctly ABSENT from `SENSITIVE_KEYS` — consistent with CLAUDE.md R10-M4 (describes encoded output, not source PII). No accidental classification drift.

**Verdict: REFUTED — all guard layers agree; no admin column is missing a layer. Prediction #3 refuted.**

### P4 — Advisory-lock collisions / connection leaks -> CLEAN
- All 5 fixed lock names (`advisory-locks.ts:19-44`) are distinct `gallerykit_*` strings. The per-image lock (`getImageProcessingLockName`, `:40`) uses a `:`-separated namespace (`gallerykit:image-processing:{jobId}`), structurally disjoint from the `_`-separated fixed names — collision is impossible regardless of jobId. The MySQL-server-scope limitation is honestly documented (`:8-15`, run-one-instance-per-server).
- `upload-processing-contract-lock.ts` release/error paths: connection is released on EVERY exit (acquired-then-release, acquired-fail-release `:39`, getConnection-throw early return `:21`, query-throw `:65-71`); the `released` flag prevents double-release. The new test pins all of these. No leak path.

**Verdict: REFUTED. Prediction #4 refuted.**

### P5 — Image-queue delete-during-processing race (`image-queue.ts:285-391`) -> CLEAN
- Per-image advisory lock (`GET_LOCK(jobId, 0)`, `:199`) ensures single-worker claim; losing worker retries with escalating backoff (`:263-281`).
- Pre-check row exists + `processed=false` (`:286-291`).
- Output-existence verification (all 3 formats non-zero, `:354-366`) BEFORE the conditional UPDATE.
- Conditional UPDATE `WHERE id=? AND processed=false` (`:372`). Both delete orderings are covered:
  - delete commits BEFORE update → `affectedRows===0` → full-directory-scan variant cleanup with `[]` arg (`:374-391`, AGG-C4-04 — catches admin-tunable non-default sizes).
  - delete commits AFTER update → delete's own transaction removes the row + variants.
- No TOCTOU: the UPDATE is atomic; `deleteImage` runs its own transaction. The advisory lock blocks the only double-process vector.

**Verdict: REFUTED — race is fully fenced. Prediction #5 refuted.**

---

## DO-NOT-RE-FILE adjudicated items — confirmed not re-litigated
- **MED-R7C2-01** (histogram clip %) — REFUTED; not examined / not re-filed.
- **REJ-R7C3-01** (`gps-exif-strip.ts` indexSize) — DISPROVED (byte-identical); not re-filed.
- **NF-R7C4-01** (`color-detection.ts:185` code-4 comment) — re-confirmed CORRECT vs H.273 this cycle; not re-filed.
- **NF-R7C5-01** (`migrate.js` baselineAllJournalMigrations dup rows) — REFUTED; not re-filed.
- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE; not re-opened.
- **settings-hash no-arg/config-arg divergence** — BENIGN-BY-DESIGN (R8-H1); not re-filed.
- **SW stamp lag-by-one** — intentional prebuild cadence; `sw.js` stamps its own parent. Not a defect; not re-filed.
- **`process-image.ts:1108` "paid" idiom; :1570/1646 download-original comments** — cosmetic, zero-behavior; optional fold-in only.
- Carried LOW/INFO deferrals (DEF-C11-01, R7C1-CR-01..04, TE-R7C2-03..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — no new evidence, no exit criterion; carried unchanged.

---

## Verdict Justification

The convergence claim survived adversarial falsification on BOTH mandated axes. For Mandate 1 I did not merely read the tests — I ran three source mutations (`pruneUploadTracker` `>`→`>=`, `resetUploadTrackerWindowIfExpired` `>`→`>=`, dropping the `BigInt(1)` acquisition arm) and confirmed each correctly fails the corresponding assertion, proving the new tests are non-tautological and pin the precise invariants their docstrings claim. For Mandate 2, all five pre-commitment hiding-places were probed against actual code (NCLX maps re-verified entry-by-entry against ITU-T H.273; privacy guards proven self-consistent across union/fixture/omit/compile-guard; advisory locks proven collision-free; image-queue race proven fenced on both delete orderings) and each was REFUTED with file:line + standard-citation evidence. Every gate is green at the real HEAD `1ef54aaa` (typecheck exit 0, 2054 tests pass, 0 fail). The only change since run-8 convergence is the two test additions that close the two prior cycle's findings — and those additions are correct.

A confident, evidence-backed **0 new findings** is the correct result. This is the fourth consecutive convergence; the codebase remains at the converged LOW-risk state. There is nothing to fix and nothing worth deferring.

## Open Questions (unscored)
- None. No code change of any severity is warranted. The carried LOW/INFO deferral register is unchanged from run-9 cycle-1.
