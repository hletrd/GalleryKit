# Aggregate Review — Run-7 Cycle-3 (HEAD `c6eff919`)

**Date:** 2026-06-19
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD):** ESLint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0 (2 admin routes / 34 actions + 5 exempt / 9 public routes); typecheck (app + scripts) exit 0; Vitest **2237 passed / 4 skipped / 0 failed** (240 files); Next.js prod build exit 0. The 4 skips are the model-weight-gated CLIP suites (`clip-offline-load` ×2, `clip-semantic-integration` ×2) — gated by design on `CLIP_MODELS_ROOT` weights, NOT failures. The +6 test count vs cycle-2 (2231 → 2237) is fully accounted for by the two cycle-2 fix deliverables (`images-action-gps-toggle-wiring.test.ts` 4 tests + the gamma28 block in `color-detection.test.ts` + `humanize-transfer-function-i18n.test.ts`).

## Context

This is cycle-3 of run-7. The delta from cycle-2's reviewed HEAD `1cdbb883` to this HEAD `c6eff919` is 4 commits: the two cycle-2 fixes (`ae5e82cb` NCLX transfer code 5 → gamma28; `eff5d8d6` browser GPS-toggle source-contract test), the cycle-2 review docs (`6bb5a49a`), and the SW_VERSION stamp refresh (`c6eff919`). **No new application-logic change beyond the cycle-2 fixes.** Both cycle-2 fixes (and the cycle-1 YCgCo fix) are independently re-verified INTACT and correctly test-pinned by the verifier, critic, document-specialist, test-engineer, designer, and architect.

This cycle's review angle deepened the NCLX-spec sweep (critic + document-specialist independently verified EVERY remaining ITU-T H.273 code, not just the two already-fixed) and re-traced all 6 highest-risk end-to-end flows. **The headline result is a NEGATIVE convergence:** the run-7 spec-error sweep has CONVERGED — every NCLX primaries/transfer/matrix code now verifies spec-correct against ITU-T H.273 / FFmpeg `libavutil/pixfmt.h`. The two fixes (matrix 8→YCgCo cycle-1, transfer 5→gamma28 cycle-2) were the complete set; the critic's pre-committed prediction of a 3rd spec error was disproved with evidence.

**Verdict: 2 new LOW findings (both comment/doc/guard tidies, zero runtime-behavior risk), 1 INFO comment-precision (critic, sibling of the document-specialist's LOW), 1 disproved candidate (debugger indexSize), 1 carried residual (HEIC GPS, reachability still unverified).** No security, data-loss, correctness, or HIGH/CRITICAL finding from any of the 11 agents. `npm audit --omit=dev`: 0 critical / 0 high / 2 moderate (documented postcss false-positive) / 0 low.

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| NCLX spec sweep CONVERGED (no 3rd error) | critic (predicted error, REFUTED by own investigation), document-specialist (all codes verified), test-engineer (no test pins wrong value), debugger (color flow clean) | **CONVERGED** — no schedulable spec finding |
| DOC-R7C3-01 / xvYCC comment imprecision (`color-detection.ts:190`) | document-specialist (DOC-R7C3-01, LOW), critic (sibling INFO at `:192-194`) | **SCHEDULE** (LOW, comment-only doc-accuracy tidy) |
| ARCH-R7C3-01 / `COLOR_IMPACTING_KEYS` un-guarded subset (`settings-hash.ts:41-53`) | architect (raise, LOW conf-M, self-mitigated) | **SCHEDULE the cheap compile-time guard** (architect's Option B) OR defer (Option A) — see below |
| indexSize unvalidated in iloc (`gps-exif-strip.ts:466`) | debugger (raise → self-DISPROVE), orchestrator (independently verified DISPROVED) | **REJECT** — every downstream read is independently bounds-checked + readSized-validated; no OOB / no GPS-leak |
| RES-R7C2-01 HEIC GPS residual | tracer (re-confirm residual), security-reviewer (could not prove branch fires) | **CARRY as residual** (reachability unverified) |
| MED-R7C2-01 histogram clip % (refuted cycle-2) | NOT re-filed by any agent | **stays REFUTED** |

---

## SCHEDULED findings (merged; both LOW; zero runtime-behavior risk)

### AGG-R7C3-01 [LOW, conf HIGH] — Two inline-comment spec imprecisions in `color-detection.ts` NCLX transfer map (xvYCC + BT.2020 wording)
**Agents:** document-specialist (DOC-R7C3-01, raise, verified vs FFmpeg + Wikipedia XvYCC), critic (sibling INFO, raise vs ITU-T H.273 Table 3/4). Two-agent agreement, same file, same class.

**Where & what (comment-only — code VALUES are all correct):**
1. `apps/web/src/lib/color-detection.ts:190` — `11: 'srgb', // R5-M1: IEC 61966-2-4 (xvYCC) — same transfer as sRGB, extended gamut`. **Inaccurate:** xvYCC (IEC 61966-2-4) uses the **BT.709 transfer function** (coefficients `{1.099, 0.018, 0.45, 4.5}`), NOT the sRGB transfer (`{1.055, 0.0031308, 1/2.4, 12.92}`). The mapped value `'srgb'` is CORRECT and internally consistent: NCLX code 1 (BT.709 itself) also maps to `'srgb'` as the documented SDR approximation, and xvYCC = BT.709 transfer, so both correctly converge to the `'srgb'` enum label. Only the *rationale* in the comment ("same transfer as sRGB") is wrong — it should say "same transfer as BT.709 (code 1), extended to negative RGB; approximated as 'srgb'."
2. `apps/web/src/lib/color-detection.ts:192-194` — block comment for codes 14/15 says they "use the **BT.2020-NCL transfer** characteristic." **Imprecise:** BT.2020-NCL is a *matrix coefficient* name (H.273 Table 4 code 9), not a transfer characteristic. The H.273 Table 3 name for codes 14/15 is "Rec. ITU-R BT.2020". The emitted value `'gamma24'` (BT.1886) and the public/admin label are CORRECT; only the wording conflates a matrix name with a transfer name.

**Authoritative sources (cross-confirmed):** FFmpeg `libavutil/pixfmt.h` (`AVCOL_TRC_IEC61966_2_4` = code 11); FFmpeg `vf_colorspace` patch #1228 (xvYCC coefficients = BT.709); Wikipedia XvYCC ("extends the standard BT.709 curve to accommodate negative R'G'B' inputs"); ITU-T H.273 Table 3 (code 14/15 = "Rec. ITU-R BT.2020") vs Table 4 (code 9 = BT.2020-NCL).

**Impact:** ZERO functional/byte/label impact. `transferFunction` is an admin-audit-only field; the encoder branches only on `pq`/`hlg` for HDR gating. Both comments mislead a future maintainer about WHY the value is what it is — exactly the kind of imprecision that, on the color surface, has repeatedly cost a cycle (the run-7 lineage caught matrix-8 and transfer-5 spec errors). Tightening the comments on the same file closes the maintainer-accuracy loop.

**Fix (comment-only, 2 sites in 1 file):**
1. `color-detection.ts:190` — reword to: `11: 'srgb', // IEC 61966-2-4 (xvYCC) uses the BT.709 transfer (same as code 1), extended to negative RGB for wider gamut; approximated as 'srgb' (= the code-1/BT.709 label) — no distinct bt709-extended label exposed.`
2. `color-detection.ts:192-194` — reword "BT.2020-NCL transfer characteristic" to "Rec. ITU-R BT.2020 transfer characteristic (H.273 Table 3 code 14/15; BT.2020-NCL is the *matrix* name, code 9 — distinct)." Keep the BT.1886/gamma24 rationale that follows; it is correct.

**Guardrail:** do NOT change any mapped VALUE. Codes 6/7 stay `gamma22` approximations; 14/15 stay `gamma24`; 11 stays `srgb`. This is a pure comment-accuracy fix. The existing tests already pin the correct values and need no change.

### AGG-R7C3-02 [LOW, conf MEDIUM] — `COLOR_IMPACTING_KEYS` is an un-guarded hand-maintained subset; add a cheap compile-time subset guard + CLAUDE.md checklist
**Agent:** architect (ARCH-R7C3-01, raise). Single-agent, but the drift mechanism is concretely verified and matches the repo's documented "fix one sibling, miss the next" failure class.

**Where:** `apps/web/src/lib/settings-hash.ts:41-53` (`COLOR_IMPACTING_KEYS`, a 9-element `as const` array) vs `apps/web/src/lib/gallery-config-shared.ts` (`GALLERY_SETTING_KEYS`) and the encoder-consumed fields in `image-queue.ts:326-331`. Test `settings-hash.test.ts` pins the 9 keys behaviorally but does NOT assert the subset-in-sync invariant.

**Problem:** `COLOR_IMPACTING_KEYS` is a parallel enumeration of byte-impacting settings with NO compile-time linkage to `GallerySettingKey` and no "adding a new color-impacting setting" checklist. Unlike the privacy surface — where `data-timeline.ts` and `publicMapSelectFields` DERIVE from the single canonical `PrivacySensitiveKeys` type via `Extract`/`Exclude` so a new key auto-propagates — the ETag-invalidation surface has no such linkage. The list is **complete and correct today** (architect audited all 9 against the encoder-consumed fields), but a future change can desync it.

**Concrete scenario:** a contributor adds a new encoder knob (e.g. `image_quality_heic`) to `GALLERY_SETTING_KEYS`, the resolver, and `processImageFormats`, but forgets `COLOR_IMPACTING_KEYS`. `settings-hash.test.ts` stays green (it only tests the existing 9). On the serve-upload.ts path, flipping the new setting no longer forces the 304→200 revalidation in the window between the setting change and the next backfill.

**Why LOW / self-mitigated (the honest bound):** (a) the STATIC serving path — the documented majority of traffic (CRT-D1) — never relied on the settings-hash; it invalidates via the mtime+size ETag; (b) CLAUDE.md mandates a backfill re-encode after ANY color/quality/size setting change for the bytes to actually change, and the re-encode uses atomic rename over the base file, changing mtime+size and invalidating BOTH paths regardless of the hash. So a missed key only loses the *convenience* serve-upload invalidation in the transient pre-backfill window — the real invalidation (backfill) still fires. No correctness/data-loss/privacy impact.

**Disposition (decision for planning):** the architect offered Option A (DEFER) or Option B (cheap compile-time subset guard + CLAUDE.md checklist now). **Recommend Option B** — it is ~5 lines + a one-line doc note, mirrors the proven `PrivacySensitiveKeys` pattern, catches a typo'd/removed key at `tsc`, has zero runtime risk, and pre-empts the exact "miss the next sibling" drift the repo keeps hitting. It does NOT close the semantic "is this NEW setting byte-impacting?" gap (that needs the human checklist), but it makes a removal/typo a hard compile error.

**Fix (Option B — zero runtime behavior change):**
1. `settings-hash.ts` — add a compile-time guard after `COLOR_IMPACTING_KEYS`: `type _ColorKeysAreSettingKeys = (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never; const _colorKeysGuard: _ColorKeysAreSettingKeys = true;` (import `GallerySettingKey` type from gallery-config-shared). This fails `tsc` if any element is not a valid setting key (catches typos/removals).
2. `CLAUDE.md` — add a one-line "Adding a new color-impacting setting" note in the admin-tunables / ETag section, parity with the migration-column checklist: "If a new admin setting changes derivative BYTES, add it to `COLOR_IMPACTING_KEYS` in `settings-hash.ts` (the subset compile-guard catches a typo, not a forgotten new key)."

**Exit criterion (if deferred instead):** (a) a new encoder-byte-impacting admin setting is added (then add it to `COLOR_IMPACTING_KEYS` + land the guard in the same change); OR (b) a stale-derivative-on-serve-upload incident in the pre-backfill window; OR (c) a general config-coupling hardening pass.

---

## REJECTED candidate (verified non-bug — recorded so the next cycle doesn't re-litigate)

### REJ-R7C3-01 — `indexSize` not validated against {0,4,8} in the iloc parser — REFUTED
**Filed by:** debugger (raise → self-DISPROVE). **Independently verified DISPROVED by:** orchestrator (direct read of `gps-exif-strip.ts:455-526`) AND the debugger's own re-verification.

**Where:** `apps/web/src/lib/gps-exif-strip.ts:466` — `const indexSize = ilocVersion >= 1 ? (sizesByte2 & 0xf) : 0;`. The `{0,4,8}` validation loop at lines 476-478 covers `offsetSize`/`lengthSize`/`baseOffsetSize` but NOT `indexSize`.

**Why it is NOT a bug:** `indexSize` (masked `& 0xf`, range 0-15) is NEVER passed to `readSized` — the index field's VALUE is never read. It is used only at line 513 (`extentEntrySize = indexSize + offsetSize + lengthSize`, a bounds-check SUM) and line 515 (`pos += indexSize`, skipping the unread index field). Line 514 bounds-checks `pos + extentEntrySize > ilocBox.dataEnd` BEFORE advancing, so a large/illegal `indexSize` either (a) trips the bounds check → returns `null` (safe reject), or (b) misaligns `pos` so the subsequent `readSized(pos, offsetSize)` / `readSized(pos, lengthSize)` reads — which are themselves bounds-checked AND `readSized`-validated (returns `null` for any size ∉ {0,4,8}, line 474) — return `null`. **No out-of-bounds read, no pointer corruption, no GPS-leak path.** A malformed HEIC is rejected (→ falls to the re-encode path = the already-tracked RES-R7C2-01 residual).

**Disposition:** REJECT as a bug. At most a defense-in-depth SYMMETRY nit (adding `indexSize` to the line 476-478 loop would be consistent with the other three sizes), but no behavioral impact. NOT scheduled. Recorded here so it is not re-filed.

---

## Carried residual (reachability unverified — NOT scheduled)

### RES-R7C3-01 (= RES-R7C2-01 / RES-R7C1-01, re-confirmed unchanged) — HEIC anomaly GPS-strip fall-through
**Agents:** tracer (Flow-1 residual, re-confirmed at `process-image.ts:1629-1633` / `gps-exif-strip.ts:460,523`), security-reviewer (could NOT empirically prove the `constructionMethod !== 0` / `ilocVersion > 2` branch fires on real iPhone HEIC). No new evidence either way.

When `strip_gps_on_upload=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer` → `null`), prebuilt Sharp lacks the HEVC encoder so the function logs an error and returns WITHOUT stripping — the on-disk original retains GPS, which the paid-download route streams. DB columns are nulled regardless (gallery UI never leaks; pure UI/file divergence on one container family). **Reachability is the critical unknown** — spec convention (HEIF/ISO 14496-12) strongly implies Apple writes the Exif item with `construction_method=0` (scrubber succeeds). Carried unchanged. **Confirming probes (zero-cost, in the deferred register):** (a) run real iPhone `.heic` fixtures through `stripGpsFromIsobmffBuffer`, assert `stripped:true` not `null`; (b) grep production logs for the `cannot strip GPS from structurally anomalous HEIC` error string. Either probe confirming reachability → escalate to HIGH/CRITICAL and schedule immediately.

---

## Refuted (do NOT re-file — stays refuted from cycle-2)

### MED-R7C2-01 — Histogram RGB clip % "divides by red-channel total only" — REFUTED (3-way, cycle-2)
NOT re-filed by ANY agent this cycle. The histogram worker (`histogram-worker.js:25-34`) increments `r/g/b` once per pixel so `sum(r)===sum(g)===sum(b)===N` always; dividing per-channel max by `totals[0]` is the correct worst-case clip fraction. The proposed `3N` fix would 3× under-report and mask real clipping. Do NOT apply to either site (`histogram.tsx:321-329`, `:651-663`).

---

## Carried-forward deferrals (re-verified unchanged, no new evidence — full register in `.context/plans/run7-cycle3/deferred.md`)

All re-verified UNCHANGED by the relevant agents this cycle; NONE met an exit criterion; NONE re-filed as new:
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified; out of touch-target-audit scope by design. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds. Code-reviewer/perf/architect re-reviewed; no new evidence. Carried.
- **ARCH-R7C2-01** [LOW] — `charge.refunded` webhook gap. Tracer + architect re-confirmed; bundle with plan-316 `async_payment_succeeded`. Carried.
- **TE-R7C2-02/03/04/05** [LOW] — Stripe webhook behavioral-test gap; semantic malformed-row route test; `logAuditEvent` truncation test; embeddings action test. Test-engineer re-confirmed; no new evidence. Carried.
- **OBS-R7C2-02..07** [LOW] — debugger design-contract observations (reconcile position backfill, non-transactional restore, failRestore temp leak, pool not .end()'d, unbounded bootstrap retry, updateTopic no FOR UPDATE). Architect re-confirmed all as documented-design/operator-mitigated. Carried.
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); lock-name separator. Architect re-confirmed cosmetic. Carried.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — full inventory + 4 parallel Explore sweeps; 9 self/agent-surfaced candidates all refuted by reading actual code (two proposed "fixes" would have been actively harmful — `sql.raw()` injection, gain-map URI misread). Truthful zero. |
| perf-reviewer | 0 | APPROVE — 3rd consecutive zero; every hot path re-derived bounded from current line numbers (rgb16 OOM guard, queue concurrency, backfill cap=2, CLIP scan cap 5000, SW LRU + 300ms HEAD timeout, BoundedMaps, transferable histogram buffer). Cycle-2 fixes perf-neutral. |
| security-reviewer | 0 | LOW risk — 3rd consecutive zero; all 11 API routes + actions + auth/session/origin/Stripe/PII/CSV/CLIP/middleware/GPS re-read at HEAD; 4 lint-gate invariants verified against code; `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic` intact; npm audit 0 crit/0 high/2 moderate (postcss false-positive). |
| critic | 0 actionable (1 INFO) | ACCEPT — pre-committed prediction of a 3rd NCLX spec error DISPROVED by exhaustive H.273 verification (spec sweep CONVERGED); GPS-toggle test window robust; doc/i18n/humanizer coherence exact; refuted MED-R7C2-01 NOT re-filed; 1 INFO comment-precision (BT.2020-NCL wording, → merged into AGG-R7C3-01). |
| verifier | 0 blockers | PASS — all 7 gates green; Vitest 2237 pass / 4 design-gated skips / 0 fail; both cycle-2 fixes + cycle-1 fix intact + test-pinned; GPS-toggle test uses critic-hardened 400-char window; 5/5 CLAUDE.md spot-checks TRUE. |
| test-engineer | 0 | CLEAN CYCLE — both cycle-2 test deliverables complete (gamma28 i18n test pins ko `'감마 2.8...'`; GPS-toggle wiring test brace-safe); "wrong value pinned" sweep exhaustive, no remaining instances; analytics-data behavioral gap is pre-existing (not new). |
| tracer | 0 confirmed | All 6 flows CLEAN (upload→PII, checkout→download, color→ETag→SW, backfill→lock→delete-race, CLIP→semantic, session→middleware→isAdmin) with file:line anchors; 1 residual (RES-R7C3-01 HEIC GPS, reachability unverified). |
| architect | 1 LOW | SOUND-WITH-NOTES — 10 in-scope surfaces verified holding their invariants; ARCH-R7C3-01 (un-guarded `COLOR_IMPACTING_KEYS` subset, self-mitigated by mandatory backfill, recommend cheap compile-guard). All deferred items re-verified unchanged. |
| debugger | 0 confirmed (1 disproved) | CLEAN PASS — the one concrete candidate (`indexSize` unvalidated, gps-exif-strip.ts:466) DISPROVED (every downstream read independently bounds-checked); fresh sweep of mluc parsing / embedding decode / blur-data-url / WI-15 finally / snapshot memoization all clean. |
| document-specialist | 1 LOW | DOC-R7C3-01 (xvYCC comment "same transfer as sRGB" → BT.709, comment-only, value correct) — verified vs FFmpeg pixfmt.h + vf_colorspace patch + Wikipedia XvYCC. ALL NCLX mappings + all load-bearing CLAUDE.md constants verified correct. → merged into AGG-R7C3-01. |
| designer | 0 | ZERO new — full a11y surface re-verified (lightbox/search/bottom-sheet/accordion ARIA, focus management); i18n parity 842=842; gamma28 humanizer case wired + localized + admin-gated; all KNOWN_VIOLATIONS counts match; DEF-C11-01 not re-raised. |

**Net schedulable findings this cycle: 2 LOW** (AGG-R7C3-01 color-detection comment imprecisions [comment-only]; AGG-R7C3-02 `COLOR_IMPACTING_KEYS` compile-guard + checklist [zero-runtime-risk hardening]).
**Refuted/rejected: 2** (MED-R7C2-01 histogram clip — stays refuted, not re-filed; REJ-R7C3-01 indexSize — disproved this cycle).
**Carried residual: 1** (RES-R7C3-01 HEIC GPS, reachability unverified).
**Carried-forward deferrals: full set** (DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — re-verified unchanged in `deferred.md`.

**Convergence signal:** the NCLX spec-error sweep has CONVERGED (critic + document-specialist + test-engineer agreement, exhaustive H.273 verification). All three security lints + typecheck + build + 2237 tests green. Three reviewers at their 3rd consecutive zero (perf, security, designer). The only two new items are a comment-accuracy tidy and a zero-runtime-risk compile-guard — both LOW, both improving the maintainer-facing color surface that has yielded the run's real fixes.

## AGENT FAILURES

None permanently — all 11 agents returned and persisted. Operational notes:
- **critic** ran read-only (Write blocked in its toolset, same as run-7 cycle-1); it delivered its complete report in its final message and the orchestrator persisted it verbatim to `critic.md`.
- **tracer** and **debugger** each completed their full substantive investigation on the first pass but went idle before writing their report files (the recurring "agent idle mid-investigation" mode seen in prior cycles). Per protocol they were re-dispatched ONCE as fresh, tightly-scoped agents seeded with the prior run's conclusions to independently re-verify; both wrote complete reports on the retry (tracer: all 6 flows CLEAN + 1 residual; debugger: 0 confirmed + 1 disproved). The orchestrator additionally independently verified the debugger's one concrete candidate (`indexSize`) directly in code before the retry, confirming the DISPROVED disposition. No agent was silently dropped.
