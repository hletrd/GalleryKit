# Aggregate Review — Run-7 Cycle-2 (HEAD `1cdbb883`)

**Date:** 2026-06-18
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Resume note:** cycle-2's first subagent died mid-PROMPT-1 (429 usage-limit) after writing 7 of 11 reviews. HEAD did not move (`1cdbb883`) and no code changed, so the 7 existing reviews (debugger, designer, document-specialist, perf-reviewer, test-engineer, tracer, verifier) are VALID at current HEAD and were NOT re-run. The 4 missing reviewers (code-reviewer, security-reviewer, critic, architect) were spawned fresh this resume and returned.

**Gate state (verifier + debugger, fresh foreground runs at HEAD):** ESLint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0; typecheck (app + scripts) exit 0; Vitest **2231 passed / 4 skipped / 0 failed** (237 files passed / 2 skipped); Next.js prod build exit 0 (implied — no build-breaking change in delta). The 4 skips are the model-weight-gated CLIP suites (`clip-offline-load` ×2, `clip-semantic-integration` ×2) — gated by design on `CLIP_MODELS_ROOT` weights, NOT failures.

## Context

This is cycle-2 of run-7. The delta from cycle-1's HEAD `17f743f7` to this HEAD `1cdbb883` is 4 commits: the two cycle-1 fixes (`60a5690c` NCLX matrix code 8 → YCgCo; `10108963` Firefox `(color-gamut: p3)` MQ doc correction), a CLAUDE.md/doc touch, and the SW_VERSION stamp refresh (`1cdbb883`). **No new application-logic change beyond the cycle-1 fixes.** Both cycle-1 fixes are independently re-verified INTACT and correctly test-pinned by the verifier, debugger, document-specialist, test-engineer, designer, perf-reviewer, and tracer.

This cycle's broader sweep (cycle-1 emphasized async/lock/transaction surfaces; cycle-2 widened to numeric/UI/cosmetic surfaces) surfaced one genuine spec-label error (R7C2-F1) of the same class as the cycle-1 YCgCo fix, one privacy-guard test asymmetry (TE-R7C2-01), and — critically — **one false-positive correctness finding (MED-R7C2-01) that two independent agents (critic, code-reviewer) plus the orchestrator's own verification refuted.**

**Verdict: 2 schedulable findings (both MEDIUM), 1 REFUTED finding (MED-R7C2-01 — must NOT be "fixed"), 1 new INFO anti-regression note (CRIT-R7C2-01), several LOW deferrable observations, 1 narrow residual (HEIC GPS), 1 LOW operational gap (charge.refunded), and 1 INFO housekeeping item (orphan migration file).** No security, data-loss, or HIGH/CRITICAL finding surfaced from any of the 11 agents. `npm audit --omit=dev`: 0 critical / 0 high / 2 moderate (documented postcss false-positive) / 0 low.

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| R7C2-F1 (NCLX transfer code 5 = gamma28) | document-specialist (raise), code-reviewer (CR-R7C2-01 CONCUR, spec-confirmed), critic (CONFIRM + REFINE) | **SCHEDULE** (MEDIUM-as-spec-error / LOW-in-practice) |
| TE-R7C2-01 (browser GPS-toggle untested) | test-engineer (raise), critic (CONFIRM + caution), security-reviewer (guard itself sound) | **SCHEDULE** (MEDIUM) |
| MED-R7C2-01 (histogram clip % denominator) | debugger (raise, "schedule"), critic (**REFUTE**), code-reviewer (CR-R7C2-02 **REFUTE → not a bug**), orchestrator (verified REFUTE) | **REJECT** — proposed fix would introduce a 3× under-report regression |

The MED-R7C2-01 refutation is the headline reconciliation of this cycle: a 3-way agreement (critic + code-reviewer + orchestrator direct verification) that the debugger's single scheduled candidate is a false positive AND that its proposed one-line fix would actively break a correct indicator.

---

## SCHEDULED findings (merged; highest severity/confidence preserved)

### AGG-R7C2-01 [MEDIUM (spec-error) / LOW (runtime impact), conf HIGH] — NCLX transfer code 5 is gamma 2.8 (BT.470BG), mislabeled gamma22 / "BT.470 System M"
**Agents:** document-specialist (R7C2-F1, raise), code-reviewer (CR-R7C2-01, spec-confirmed + impact-bounded), critic (CONFIRM + REFINE). Three-agent agreement.

**Where:**
- Code: `apps/web/src/lib/color-detection.ts:183` — `5: 'gamma22', // BT.470 System M` (BOTH the mapped value AND the inline comment are wrong: System M is code 4; code 5 is BT.470BG = PAL/SECAM, gamma 2.8).
- Code: `apps/web/src/lib/color-detection.ts:180-181` — block comment groups "values 4, 5, 7" as "the gamma-2.2 family (BT.470M, BT.470BG, SMPTE 240M respectively)" — wrong grouping (5 is not gamma-2.2).
- Type: `apps/web/src/lib/color-detection.ts:25` — `transferFunction` union lacks `'gamma28'` (so the fix requires adding it, exactly like cycle-1 added `'ycgco'`).
- Test pinning the wrong value: `apps/web/src/__tests__/color-detection.test.ts:206` (block comment "values 4, 5, 7 (gamma-2.2 family)") and `:213-217` (`it('maps nclx transfer=5 to gamma22')` asserting `'gamma22'`). **Third instance of the "test actively pins the wrong spec" pattern in the run-7 lineage (after YCgCo in cycle-1).**

**Authoritative source (cross-confirmed by document-specialist + code-reviewer + critic):** FFmpeg `libavutil/pixfmt.h` is the canonical mirror of ITU-T H.273 Table 3: `AVCOL_TRC_GAMMA22 = 4 ///< also ITU-R BT470M` and `AVCOL_TRC_GAMMA28 = 5 ///< also ITU-R BT470BG`. BT.470 System B/G (PAL/SECAM 625-line) carries an assumed display gamma of **2.8**; System M (code 4, NTSC) is gamma 2.2.

**Impact:** LOW in practice. `transfer_function` is an **admin-audit-display-only** field (consumed in exactly two places: written to DB at `images.ts:359`; humanized for the admin audit label via `humanizeTransferFunction`). **Zero delivery-byte impact** — the encoder decision matrix keys on `color_pipeline_decision`/`colorPrimaries`, and HDR gating keys on `isHdr` (only `pq`/`hlg` flip it; gamma28 stays SDR). A PAL/SECAM-mastered still declaring NCLX transfer=5 is rarer than YCgCo. But it is a genuine spec error propagating into code + comment + test, and the cycle-1 YCgCo fix established the exact remediation pattern.

**Fix (9 sites — established by the cycle-1 YCgCo pattern; complete-consumer-traced by code-reviewer + critic):**
1. `color-detection.ts:25` — add `'gamma28'` to the `transferFunction` union.
2. `color-detection.ts:183` — `5: 'gamma28', // ITU-T H.273 Table 3 value 5 = BT.470BG (PAL/SECAM gamma 2.8) — NOT System M (that is code 4)`.
3. `color-detection.ts:180-181` — correct the block comment (5 is gamma 2.8, not in the gamma-2.2 family).
4. `components/color-details-section.tsx` `humanizeTransferFunction` (~line 70-80) — add `case 'gamma28': return t('viewer.transferGamma28');`.
5. `messages/en.json` — add `viewer.transferGamma28` (e.g. `"Gamma 2.8 (BT.470 BG / PAL·SECAM)"`).
6. `messages/ko.json` — add `viewer.transferGamma28` (e.g. `"감마 2.8 (BT.470 BG / PAL·SECAM)"`). The i18n key-parity gate (DOC-R5C3-07) requires the SAME key set in both files; value shape may differ.
7. `color-detection.test.ts:206` — fix block comment (remove 5 from "gamma-2.2 family").
8. `color-detection.test.ts:213-217` — flip the assertion to `expect(signals.transferFunction).toBe('gamma28')` and rename the test `it('maps nclx transfer=5 to gamma28 (BT.470BG)')`.
9. `CLAUDE.md` — add `gamma28` to the `transfer_function` enum enumeration in the `images` color columns table.

**REFINE (critic + code-reviewer agreement — IMPLEMENTATION GUARDRAIL):** codes **6** (SMPTE170M, test at `color-detection.test.ts:275`) and **7** (SMPTE240M, test at `:219`) MUST be left as `'gamma22'` approximations and their tests MUST NOT be changed. The principle: "map exactly when an exact label exists (code 5 → gamma28 once added), approximate only when none does (6/7 have no exact single-gamma label — piecewise BT.709-like curves)." Splitting 5 while leaving 6/7 is internally coherent, NOT a contradiction.

**Note:** does NOT change `isHdr` (derived solely from `pq`/`hlg`); no upload-gate or delivered-byte impact. Pure audit-label correctness + test correctness.

### AGG-R7C2-02 [MEDIUM, conf HIGH] — Browser upload GPS-strip-on-upload toggle has NO test (asymmetric with the LR path)
**Agents:** test-engineer (TE-R7C2-01, raise), critic (CONFIRM + caution on test fragility), security-reviewer (confirms the guard ITSELF is sound — this is a coverage gap, not a guard defect). Three-agent agreement.

**Where:** `apps/web/src/app/actions/images.ts:310-317`
```ts
if (uploadConfig.stripGpsOnUpload) {
    exifDb.latitude = null;
    exifDb.longitude = null;
    // PP-BUG-3: also strip GPS EXIF from the on-disk original
    await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
}
```

**Why it matters (privacy-critical regression surface):** this guard is the ONLY thing keeping a photographer's home GPS out of the on-disk ORIGINAL that the paid-download route (`/api/download/[imageId]`) streams byte-for-byte to paying customers. `strip_gps_on_upload` defaults to `false`, so the guard is the sole gate. **The guard itself is verified correct** (security-reviewer + critic both confirmed DB-null + on-disk-strip are inside the same conditional, gated on the upload-start config snapshot).

**The asymmetry:** the PARALLEL Lightroom-plugin upload path has a source-contract pin (`lr-upload-hdr-gate.test.ts:95-104` — asserts `stripGpsFromOriginal(` appears after the `config.stripGpsOnUpload` guard). The browser path — the PRIMARY upload surface — has ZERO test references to `uploadConfig.stripGpsOnUpload` (grep across all 237 test files confirms no hits). A refactor of `uploadImages()` dropping or relocating the guard would leave the entire suite green while silently leaking GPS to paid downloads — the same class of regression PP-BUG-3 originally fixed.

**Fix:** add `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts` (~3 source-contract tests mirroring `lr-upload-hdr-gate.test.ts:95-104`): (a) imports `stripGpsFromOriginal` from `@/lib/process-image`; (b) the `stripGpsFromOriginal(` call index > the `uploadConfig.stripGpsOnUpload` guard index; (c) `exifDb.latitude = null` / `exifDb.longitude = null` appear inside the same guard block.

**CAUTION (critic REFINE — IMPLEMENTATION GUARDRAIL):** do NOT use a naive `SRC.indexOf('}', guardIndex)` to slice the guard block (the test-engineer's sketch did) — the first `}` after the guard happens to be the `if`-close only because there's no nested brace today; a future edit adding an object literal or `${}` template inside the block would slice early and false-pass. Use a brace-balanced slice OR assert the three substrings each appear within a fixed character window after the guard. The import + ordering assertions are robust as written; only the block-extraction needs hardening.

---

## REFUTED finding (do NOT schedule, do NOT "fix")

### REJ-R7C2-01 (= MED-R7C2-01) — Histogram RGB clip % "divides by red-channel total only" — REFUTED: the math is CORRECT
**Filed by:** debugger (MED-R7C2-01, marked as the single schedulable candidate). **Refuted by:** critic (REFUTE), code-reviewer (CR-R7C2-02 → not a runtime bug), AND orchestrator direct verification.

**Where:** `apps/web/src/components/histogram.tsx:321-329` (canvas clip-blink strips) AND `:651-663` (visible text % labels).

**Why it is NOT a bug (verified 3 ways):** the sole histogram producer is `apps/web/public/histogram-worker.js:25-34`, which increments `r[rv]++; g[gv]++; b[bv]++` exactly once per pixel in the same loop iteration. Therefore `sum(r) === sum(g) === sum(b) === width×height = N`, **always, for every image, by construction.** The three channel totals are mathematically identical, so dividing the per-channel max (`Math.max(r[0],g[0],b[0])`) by `totals[0]` (red total = N) yields exactly the per-channel worst-case clip fraction the comment intends. The orchestrator read both the worker and both clip sites and confirmed this.

**Why the proposed fix is HARMFUL:** the debugger's recommended `total = totals[0] + totals[1] + totals[2]` makes the denominator `3N`. A genuine 20%-clipped channel would then report `1000/15000 = 6.7%` — a **3× under-report that MASKS real clipping** on the photographer's headline color-audit surface. The debugger's "concrete trigger" (red total 5000, green clip 1000) is mathematically impossible: if there are 5000 pixels, the green total is also 5000, and 20% is the CORRECT answer.

**Disposition:** REJECT. Do NOT apply the proposed division fix to EITHER site. The only true (optional, non-scheduled) tidy is a one-line comment at `histogram.tsx:322` documenting that the three channel totals are provably equal (= N), so a future reviewer doesn't re-file this a fourth time — see CRIT-R7C2-01 / AGG-R7C2-03 below.

### AGG-R7C2-03 (= CRIT-R7C2-01) [INFO, conf HIGH] — Anti-regression note: histogram has TWO identical clip-% sites; the proposed MED-R7C2-01 fix would break one and leave the other inconsistent
**Agent:** critic (new). **Where:** `histogram.tsx:321-329` (canvas) + `:651-663` (text labels) — both correct as written; both share the equal-totals invariant.

**Actionable content:** this is NOT a live bug — it exists to prevent a bad fix. If a planner took the debugger's "fix is one line" recommendation literally and applied it to L323 only, they would (a) introduce the 3× under-report at site 1, and (b) leave site 2 (the user-visible percentage labels) inconsistent. Both sites must be reasoned about together; the correct disposition is "leave both alone." **Optional non-scheduled tidy:** add a brief comment at `histogram.tsx:322` (and optionally `:652`) noting the provably-equal channel totals. Pure prevention; zero behavior change.

---

## LOW findings & observations (deferrable — severity/confidence preserved)

### ARCH-R7C2-01 [LOW, conf MEDIUM, deferrable] — `charge.refunded` Stripe webhook gap (Dashboard refund leaves entitlement live)
**Agents:** tracer (Flow-3 residual, raise), architect (ARCH-R7C2-01, formalized), critic (CONFIRM as operational gap). **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88` (handler matches ONLY `checkout.session.completed`).

**Problem:** a refund issued directly in the Stripe Dashboard fires `charge.refunded`, which falls through to `return { received: true }` with no local state change. The `entitlements` row stays `refunded=false` with a live `downloadTokenHash`, so the customer can still download a refunded photo until an admin ALSO clicks Refund in the in-app `/sales` UI (`sales.ts:222-249` converges local state reactively on `charge_already_refunded`).

**Why LOW / deferrable:** bounded — refunds are admin-initiated and the in-app refund path converges state correctly; only the Dashboard-only refund workflow leaves a stale-live entitlement, which self-closes within 24 h (download token expiry). NOT a money-taken-no-goods defect. Sibling of the already-documented `async_payment_succeeded` gap (CLAUDE.md / plan-316 CRT-R5C1-04).

**Architect recommendation:** bundle the `charge.refunded` handler with the deferred plan-316 `async_payment_succeeded` handler — both are entitlement-lifecycle webhook branches the route doesn't yet handle and should land together. Cheap CLAUDE.md note now (parity with the async-payment Warning block) is defensible but deferrable.

### TE-R7C2-04 [LOW, conf HIGH] — `logAuditEvent` metadata-truncation logic untested
**Agent:** test-engineer (new). **Where:** `apps/web/src/lib/audit.ts:8-51`. Three untested paths: surrogate-pair-safe truncation (>4096 chars), serialization-failure fallback, and the insert row shape. Called from 10 admin-action files; sole audit trail for admin mutations. The sibling `purgeOldAuditLog` IS tested — conspicuous asymmetry. **Why LOW:** pure TDD opportunity on a security-adjacent lib; current code is correct; `.catch(console.debug)` callers swallow throws (audit row lost, not a crash). Suggested: `audit-log-event.test.ts` (3 behavioral tests, mocked DB).

### TE-R7C2-03 [LOW, conf HIGH, re-raised from TE-R7C1-03] — Semantic route malformed-embedding row-skip untested at route level
**Agent:** test-engineer (re-raised). **Where:** `apps/web/src/app/api/search/semantic/route.ts:272-279`. The decoder primitive IS tested (`clip-embedding-column-roundtrip.test.ts:89`); the route-level `.filter(m => m !== null)` for a MIXED valid+malformed result set is not. **Why LOW:** 1-test addition to an existing well-structured behavioral file; mock scaffolding already present. Regression scenario: a refactor making a single null embedding throw inside `.map()` would 500 semantic search for everyone with ~445 production embeddings.

### TE-R7C2-02 [LOW, conf HIGH, re-raised from TE-R7C1-02] — Stripe webhook route: 100% source-contract, 0% behavioral
**Agent:** test-engineer (re-raised, with new evidence). **Where:** `apps/web/src/app/api/stripe/webhook/route.ts` (454 lines, ~15 money branches) vs `stripe-webhook-source.test.ts` (all 9 tests are source-text string matching; ZERO call `POST()`). **Why LOW / deferrable:** the route requires Stripe signature verification to reach interesting branches (raising mock complexity); the source-contract tests catch documented historical regressions; the checkout/download/semantic routes show behavioral IS achievable. Highest residual value of the LOW set but highest effort.

### TE-R7C2-05 [LOW, informational] — `embeddings` server action has no dedicated test
**Agent:** test-engineer. `apps/web/src/app/actions/embeddings.ts` — every other action file has a dedicated or cycle-fixture test except this one. Heavy lifting is in tested libs; `action-origin` lint enforces the `requireSameOriginAdmin()` guard statically. Worth a source-contract pin next time the action is touched.

### Debugger LOW observations (NOT scheduled — documented design contracts or masked plumbing gaps)
All confirmed by the critic as correctly NOT scheduled:
- **OBS-R7C2-02** [LOW, conf H] — `reconcileLegacySchema` `position` backfill (`migrate.js:469-481`) not re-runnable after a partial-run crash. Architect assessment: **ACCEPTABLE** — reconcile/bootstrap-path only, ~1s crash window, self-degrades benignly (consuming query `data.ts:1218` has an `imageId` secondary sort, so output degrades to upload-order, never broken/random). Production DBs already have `position` populated.
- **OBS-R7C2-03** [LOW, conf H] — `restoreDatabase` non-transactional `mysql --one-database`; mid-restore crash = half-applied schema (`db-actions.ts:454-519`). Operator-runbook-mitigated (pre-restore backup); MySQL DDL can't roll back regardless. Architect found no reconcile-path idempotency hole beyond the benign position one.
- **OBS-R7C2-04** [LOW, conf H] — `failRestore` temp-file leak on internal sync throw (`db-actions.ts:465-475`). Very low probability; operator can `rm /tmp/restore-*.sql`.
- **OBS-R7C2-05** [LOW, conf M] — DB pool never `.end()`'d on shutdown, masked by `process.exit(0)` (`db/index.ts` vs `instrumentation.ts`).
- **OBS-R7C2-06** [LOW, conf M] — unbounded `scheduleBootstrapRetry` reschedule (`image-queue.ts:582-606`); retry-until-DB-up is the documented contract.
- **OBS-R7C2-07** [LOW, conf M] — `updateTopic` rename SELECT without `FOR UPDATE` (`topics.ts:248-286`); `ON DELETE SET NULL` bounds the consequence to "one image silently loses its topic link," not corruption. Architect-owned locking-model change, not a debugger-schedulable fix.

### INFO housekeeping
- **INFO-R7C2-08** [INFO, conf H] — orphan migration file `apps/web/drizzle/0014_drop_reactions.sql` on disk but not in `_journal.json` (the journal records the OTHER 0014, `add_icc_profile_name`). Architect: **ACCEPTABLE but a worthwhile LOW tidy** — the file is unreachable (no journal entry runs it; the cleanup was already applied via the legacy reconcile path). Honest fix: DELETE the orphan file so the drizzle dir matches its own "every .sql is journaled" runbook invariant. Schedulable opportunistically; not blocking. (Per repo destructive-action policy, deleting a tracked file should be confirmed — but this is recorded as INFO/optional, not auto-applied this cycle.)
- **INFO-R7C2-09** [INFO, conf M] — `getImageProcessingLockName` uses `:` separator while all other advisory locks use `_` (`advisory-locks.ts:40-41`). Cosmetic; no collision (MySQL lock names are exact-match). Not scheduled.

---

## Narrow residual (reachability unverified — NOT scheduled)

### RES-R7C2-01 (= RES-R7C1-01, re-confirmed + narrowed) [residual] — HEIC anomaly GPS-strip fall-through
**Agents:** tracer (Flow-1 residual), security-reviewer (confirms same documented narrow residual, not escalated), critic (CONFIRM as residual). **Where:** `apps/web/src/lib/process-image.ts:1628-1634` + `gps-exif-strip.ts:460,523`.

When `strip_gps_on_upload=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer` returns `null` — e.g. `construction_method ≠ 0` or `ilocVersion > 2`), prebuilt Sharp lacks the HEVC encoder and cannot re-encode, so the function logs an error and returns WITHOUT stripping — the on-disk original retains GPS, which the paid-download route streams. DB columns are nulled regardless (gallery UI never leaks; pure UI/file divergence on one container family).

**Why NOT scheduled:** reachability is the critical unknown. Spec convention (HEIF/ISO 14496-12) strongly implies Apple writes the Exif item with `construction_method=0` (scrubber succeeds), but no empirical probe was possible (Sharp on the review host cannot encode HEVC). The 28-test `strip-gps-from-original.test.ts` suite confirms the ISOBMFF walker is correct for `construction_method=0` items. **Confirming probes (zero-cost, recorded in deferred register):** (a) run real iPhone `.heic` fixtures (multiple iOS versions + grid/burst/Motion) through `stripGpsFromIsobmffBuffer`, assert `stripped:true` not `null`; (b) grep production logs for the `cannot strip GPS from structurally anomalous HEIC` error string.

---

## Rejected candidates (verified NON-bugs — recorded so the next cycle doesn't re-litigate)

From the debugger (REJ-1..10), code-reviewer (REJ-CR-A..H), critic (DISP-1..6), security-reviewer, and architect:
- **MED-R7C2-01 histogram clip math** — REFUTED (see REJ-R7C2-01 above). 3-way agreement.
- **Timezone skew on-this-day / year-in-review** (debugger REJ-1) — documented PP-BUG-1 invariant (write + read both use V8-local interpretation; Docker UTC aligns). Re-open only if deploy TZ ≠ UTC.
- **ReDoS in sanitize.ts:122 / password-replace** (debugger REJ-2) — no nested quantifiers; flat optionals match linearly in V8 irregexp.
- **`parseImageSizes` NaN** (debugger REJ-3, code-reviewer/critic DISP-5) — upstream-guarded by `normalizeConfiguredImageSizes`.
- **Unguarded `touches[0]`/`changedTouches[0]`** (debugger REJ-4) — Touch Events spec guarantees non-empty lists; TS types non-nullable.
- **`new Date(capture_date)` implementation-defined** (debugger REJ-5) — V8 server-side parse aligns with the write path; all consumers are server components.
- **`humanizeColorPrimaries` switch null on unknown** (debugger REJ-6) — TS-exhaustive over a closed union; blocking typecheck gate catches a missing case.
- **Advisory-lock release on every path** (debugger REJ-7) — all 5 `GET_LOCK` sites release in `finally` on dedicated connections + auto-release on close.
- **Cache invalidation race** (debugger REJ-8) — only React request-scoped `cache()`; ISR invalidated after DB commit.
- **Deploy prune safety** (debugger REJ-9) — all three documented guarantees hold (prune-after-up, image-in-use survives, no `-a` on volume prune).
- **Stripe webhook idempotency** (debugger REJ-10) — unchanged from cycle-1; 3-layer idempotency intact.
- **`use-display-capability` snapshot loop / Firefox fallback** (code-reviewer REJ-CR-B) — value-cached snapshot guards React #185; conservative `'srgb'` fallback correct.
- **`smart-collections` query-compiler injection / proto-pollution** (code-reviewer REJ-CR-C, security-reviewer) — `validateNode` enforces scalar values + depth/IN bounds + per-column operator narrowing; Drizzle parameter binding; `JSON.parse` wrapped.
- **`view-retention` future-cutoff on bad env** (code-reviewer REJ-CR-D) — falls back to 395-day default on non-finite/non-positive (mirrors audit-log COR-R4C6-10).
- **`request-origin` host port-strip off-by-one** (code-reviewer REJ-CR-E) — `:443`→slice(0,-4), `:80`→slice(0,-3), both exact; fail-closed default.
- **fire-and-forget embedding/caption unhandled rejection** (code-reviewer REJ-CR-F) — both IIFEs fully try/catch-wrapped; no process-crash path.
- **money/entitlement float arithmetic** (code-reviewer REJ-CR-G) — integer cents end-to-end; `Number.isInteger && > 0` webhook validation.
- **`fetchCandidateCount` rows[0] OOB** (code-reviewer REJ-CR-H) — explicit `if (!rows[0]) return 0` guard.
- **og-photo-fetch SSRF / middleware non-crypto cookie** (security-reviewer) — disproved; middleware is intentionally a format gate, trust boundary is `verifySessionToken` + per-action `isAdmin()`.
- **F1 fix incomplete / misses a consumer** (critic DISP-3) — only `humanizeTransferFunction` humanizes the transfer enum; fix surface is complete.
- **F1 codes 6/7 contradiction** (critic DISP-4) — coherent asymmetry (6/7 have no exact label; 5 does).
- **CLAUDE.md doc-drift on 7 load-bearing constants** (critic DISP-2) — zero drift (IMAGE_PIPELINE_VERSION=7, 9 COLOR_IMPACTING_KEYS, 2048-byte embedding decode, DEFAULT_IMAGE_SIZES, VIEW_RETENTION_DAYS=395, pool 10/queue 20, NCLX gamma mappings). The harness-injected "5 COLOR_IMPACTING_KEYS" snapshot line is a stale artifact; HEAD correctly says 9.

---

## Carried-forward deferrals (run7-cycle1 register — re-verified, no new evidence)

- **DEF-C11-01** [LOW] — search dialog `<Input>` is 32 px tall (`h-8`) at `apps/web/src/components/search.tsx:374`. Designer + perf-reviewer both re-verified unchanged; NOT re-raised per orchestrator directive. `<Input>` is deliberately out of `touch-target-audit.test.ts` scope. Exit criteria unchanged. Carried forward.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country-breakdown sentinel; no timeline month/day/year bounds validation. All re-reviewed for new evidence (none); remain correctly deferred. Carried forward.
- **TE-R7C1-02 / TE-R7C1-03** — re-raised THIS cycle as TE-R7C2-02 / TE-R7C2-03 with new evidence (see LOW findings above); they remain deferrable LOW.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 0 new (2 LOW evidence/refinements on others' findings) | APPROVE — CR-R7C2-01 spec-confirms R7C2-F1 (bounds to admin-label only); CR-R7C2-02 **REFUTES** MED-R7C2-01 (worker guarantees equal channel sums); 8 self-hunted candidates disproved. |
| security-reviewer | 0 | LOW risk — every attack surface re-read at HEAD; auth/session/origin/Stripe/PII/CSV/CLIP/middleware all clean; 4 lint-gate invariants verified against code; GPS guard sound; npm audit 0 crit/0 high/2 moderate (postcss false-positive). |
| critic | 1 new (CRIT-R7C2-01 INFO) | ACCEPT-WITH-CHANGES — **REFUTES** MED-R7C2-01 (proposed fix = 3× under-report regression); CONFIRMS F1 + TE-R7C2-01 each with a REFINE; CRIT-R7C2-01 = 2nd histogram clip site (anti-regression). Zero doc-drift across 7 constants. |
| architect | 1 new (ARCH-R7C2-01 LOW, deferrable) | SOUND-WITH-NOTES — 8 invariants verified structurally; OBS-R7C2-02 ACCEPTABLE; INFO-R7C2-08 worthwhile-LOW-tidy (delete orphan); charge.refunded → bundle with plan-316 async_payment_succeeded. |
| verifier | 0 blockers | PASS — full suite 2231 pass / 4 design-gated skips / 0 fail; all 6 gates exit 0; both cycle-1 fixes intact + test-pinned; 5 CLAUDE.md claims spot-checked TRUE. |
| test-engineer | 1 MED + 4 LOW | TE-R7C2-01 (MED, browser GPS-toggle untested); TE-R7C2-02/03 (re-raised LOW); TE-R7C2-04 (LOW, audit truncation untested); TE-R7C2-05 (LOW info, embeddings action). NCLX YCgCo cycle-1 fix has adequate behavioral test. |
| tracer | 0 confirmed | 6 flows: 4 CLEAN; RES-R7C2-01 (HEIC GPS residual, reachability unverified); Flow-3 charge.refunded operational residual (→ ARCH-R7C2-01). |
| document-specialist | 1 MED | R7C2-F1 (NCLX transfer code 5 = gamma28) — verified vs FFmpeg pixfmt.h / ITU-T H.273. Both cycle-1 fixes verified FIXED. All other claims (Sharp/libvips, OWASP Argon2id, Stripe, WCAG, browser matrix) CORRECT. |
| debugger | 1 MED (REFUTED) + 6 LOW + 2 INFO | MED-R7C2-01 (histogram clip — **subsequently REFUTED** by critic + code-reviewer + orchestrator); OBS-R7C2-02..07 LOW; INFO-R7C2-08/09. 10 rejected candidates documented. |
| perf-reviewer | 0 | APPROVE — converged; cycle-1 fixes have no perf impact; embeddings backfill / smart-collection eval / download streaming / analytics aggregation all bounded; 14 commonly-missed checks clean. |
| designer | 0 | ZERO new — full a11y surface re-verified; the one render-path delta (`'YCgCo'` humanizer case) correctly wired/admin-gated/contrast-safe/localized; i18n parity 841=841; 61 a11y/privacy/color tests green. |

**Net schedulable findings this cycle: 2 MEDIUM** (AGG-R7C2-01 NCLX transfer code 5 = gamma28; AGG-R7C2-02 browser GPS-toggle source-contract test).
**Refuted: 1** (MED-R7C2-01 histogram clip — must NOT be "fixed").
**New INFO anti-regression: 1** (AGG-R7C2-03 / CRIT-R7C2-01 — optional histogram comment tidy).
**Deferrable LOW: 6** (ARCH-R7C2-01, TE-R7C2-02/03/04/05, plus the 6 debugger OBS as a class) + carried-forward (DEF-C11-01, R7C1-CR-01..04).
**Residual: 1** (RES-R7C2-01 HEIC GPS, reachability unverified).
**INFO housekeeping: 2** (INFO-R7C2-08 orphan migration, INFO-R7C2-09 lock-name separator).

## AGENT FAILURES

None permanently. The resume completed all 4 missing reviewers (code-reviewer, security-reviewer, critic, architect) on the first attempt — no retries needed. The 7 pre-existing reviews from the interrupted first pass were valid at unchanged HEAD `1cdbb883` and were preserved as-is for provenance. All 11 per-agent files persisted.
