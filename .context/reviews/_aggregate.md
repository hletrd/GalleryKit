# Aggregate Deep Review — Run-7 Cycle 1 (review-plan-fix)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6 photo gallery)
**Cycle:** orchestrator "cycle 1/100" of a fresh run (this run, internally run-7). The working tree carries the prior run's uncommitted plan-329/330 partial work (admin error.tsx AGG-9 split, admin-backfill-runner.ts AGG-5 formula + its test, sw.js) plus the prior cycle's review `.md` files.
**Agents that returned (10/10):** code-reviewer, security-reviewer, architect (perf+arch), critic, verifier, test-engineer, tracer, debugger, document-specialist, designer. **No agent failures.**

**Gate baseline measured live this cycle (multiple agents re-ran independently):**
- `npm run lint` → **exit 0** (clean — the prior aggregate's AGG-2 ESLint error is genuinely fixed at HEAD)
- `npm run typecheck` → **exit 0** (typecheck:app + typecheck:scripts)
- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → **all exit 0**
- `npm test` → 2025 passed / 1 timeout-flake (`client-server-only-boundary.test.ts`, passes isolated in ~2.2s → effectively 2026/2026)

> The previous run-6 cycle-1 aggregate has been superseded by this file. Per-agent files were overwritten by this cycle's fan-out.

---

## TOP-LEVEL FINDING: the in-flight plan PROGRESS tables are badly STALE

Five independent agents (code-reviewer, verifier, test-engineer, critic, tracer) converged on the same meta-finding: **plan-329 and plan-330 mark many items TODO/deferred that are ALREADY IMPLEMENTED and test-backed at HEAD.** The prior cycle's ralph loop landed the fixes but never updated the tables. Re-scheduling them would be wasted work or, worse, would write tests that contradict existing passing ones.

| Item | Plan says | Reality at HEAD | Evidence |
|---|---|---|---|
| AGG-8 (TriState guard) | plan-329 #5 TODO | **DONE** | `isTriState` + early `invalidInput`, `images.ts:907-916`; 4 malformed-payload test cases exist |
| AGG-13 (Select coercion) | plan-330 deferred | **DONE** | `settings-client.tsx:622` value-coercion present |
| AGG-16 (touch-target Link/anchor + root files) | plan-329 #6 TODO | **DONE** | `touch-target-audit.test.ts` scans root `app/[locale]/*.tsx` (≈59-65) + `<Link>`/`<a>` FORBIDDEN patterns (≈387-429) + synthetic-fail fixtures; commit c1a1227a |
| AGG-10 (home title doubling) | plan-329 #2 TODO | **DONE (both branches)** | `(public)/page.tsx:50` `metadataTitle = { absolute: title }`, returned in both og-image and latest-photo branches; commit 8fc403a2 |
| AGG-11 (settings aria-describedby) | plan-329 #3 TODO | **PARTIAL** — 8 wired, ~10 hint `<p>`s still unwired (see AGG-R7-04) | grep: 8 `aria-describedby`; designer enumerated the unwired controls |
| AGG-1 (backfill honesty) | plan-328 #2 DONE | **DONE (verified)** | real `processed`/`errors` mirrored, `lastError` in fatal catch, UI reads `backfillStatus.processed`; en/ko `{errors}` parity; pinned by `admin-backfill-runner-fatal-counters.test.ts` |
| AGG-3 / AGG-4 (Unicode strip) | plan-328 #3/#4 DONE | **DONE (verified)** | `process-image.ts:574` + `images.ts:1007` global strip; both `sanitizeForOg` use `/g` strip (`170297ed`) |
| AGG-6 / AGG-7 (test obligations) | plan-328 #5/#6 DONE | **DONE (verified)** | status-shape + fatal-counters + migration-monotonicity tests exist and pass |
| AGG-18 (advisory-lock + upload-paths tests) | plan-330 deferred | **DONE** | 5 lock constants pinned + non-mocked upload-paths tmpdir test (test-engineer) |

**Consequence for PROMPT 2:** the new plan must (a) correct these stale tables to DONE rather than re-scheduling, and (b) schedule only the genuinely-open findings below.

---

## Cross-agent convergence map — GENUINELY OPEN this cycle (highest signal first)

| Agg ID | Finding | Severity (max) | Conf | Agents | Status |
|---|---|---|---|---|---|
| **AGG-R7-01** | **Stale pool-budget formula in 3 doc/comment sites** contradicts the changed code. `admin-backfill-runner.ts` file-header docblock (~28-35) still asserts cap `= floor((LIMIT-2)/2) = 4`; `db/index.ts:16` comment still says `(LIMIT-2)/2`; the function-body comment (~103-122) + code + test now correctly say cap=2 (RESERVED=max(3,ceil(LIMIT/2))). Self-contradicting file. | **MED** (doc/maintainability — operator drift on the fixed invariant) | High | **6** (CRT-3, CRT-4, ARCH-01, TRC-5, DOC-05, perf) | NEW — half-applied fix |
| **AGG-R7-02** | **Backfill poll `setTimeout`s leak — no unmount guard.** `settings-client.tsx` `handleBackfill` schedules two post-trigger refreshes (+3s/+10s) with no `clearTimeout` in any cleanup; leaving Settings within 10s fires `setBackfillStatus` on an unmounted tree. AGG-15's timer-cleanup half (prescribed in the prior aggregate) was never implemented — only the mount-effect half landed. | **MED** | High | 1 (BUG-1) | NEW — regression-survivor |
| **AGG-R7-03** | **DES-02: both `error.tsx` shells now render NO visible heading.** The AGG-9 fix correctly moved the accessible name to an `sr-only <h1>` and left the big title as a faint `/30` (~1.5:1) `aria-hidden` glyph — but unlike `not-found.tsx` (visible readable `<h1>` + `/60` decorative numeral), a SIGHTED user now sees a faint title and no real heading. Inconsistent with the repo's own 404 pattern. | **MED** (a11y/UX, WCAG 1.4.3 for sighted users) | High (static) | 2 (DES-02, designer; corroborated by critic CRT re error shell) | NEW — introduced by AGG-9 working-tree fix |
| **AGG-R7-04** | **~10 settings controls have visible hint `<p>` NOT wired via `aria-describedby`** (8 ARE wired). Unwired: 3 quality inputs (~320/333/346), 3 chroma/effort selects (~437/454/480), wide-gamut-max-source-pixels (~494), 3 license inputs (~662/674/686). Blind admins miss consequential hints (e.g. "AVIF effort: higher = smaller/slower"). | **MED** (a11y, WCAG 1.3.1/3.3.2) | High (static) | 2 (DES-01, designer; AGG-11 partial) | PARTIAL — 8 done, remainder open |
| **AGG-R7-05** | **AGG-9 admin-error H1 split + AGG-10 home-title `absolute` ship WITHOUT regression tests.** A revert to the faint accessible name (AGG-9) or a dropped `absolute` (AGG-10 → `GalleryKit \| GalleryKit`) regresses silently. `error-shell.test.ts` covers only the global-error helpers. | **MED** (test) | High | 3 (TEST-1, TEST-2, CRT-8) | NEW — test obligation for landed fixes |
| **AGG-R7-06** | **plan-330 AGG-17 deferral is built on a 401-vs-403 misread.** `withAdminAuth` wrong-SCOPE branch returns **401** (already pinned by `api-auth-response-headers.test.ts:103`); **403** is the cross-ORIGIN (CSRF) branch. The deferral's exit criterion would write a test asserting 403-for-wrong-scope that contradicts the existing passing 401 test. | **LOW** (doc/test correctness) | High | 2 (CRT-5, TEST-4) | NEW — correct the deferral note |
| **AGG-R7-07** | **DES-03: upload dropzone `aria-disabled` honesty gap.** `upload-dropzone.tsx:~397-407` keeps `role="button"` focusable + clickable under `aria-disabled`; only the hidden `<input>` is truly disabled, so the disabled affordance isn't enforced (keyboard/AT users can still activate). | **MED** (a11y, WCAG 4.1.2) | High (static) | 1 (designer DES-03) | NEW |
| **AGG-R7-08** | **Doc drift batch (CLAUDE.md):** (a) `COLOR_IMPACTING_KEYS` has **9** keys (5 color + 3 quality + `image_sizes`), not "5"/"3" as CLAUDE.md:260 + `settings-hash.ts:7-9` docstring state; (b) "Single Sharp instance with `clone()`" (CLAUDE.md:216) overstates — encoder opens a fresh `sharp()` per format+size (WI-14), contradicting CLAUDE.md's own line 246; (c) `IMAGE_PIPELINE_VERSION = 7` is defined in `gallery-config-shared.ts:21` (re-exported `process-image.ts:303`), not in process-image.ts as CLAUDE.md:92 implies (value 7 is correct); (d) backfill env-var docs missing in-app `ADMIN_BACKFILL_CONCURRENCY` (default 1, pool-capped to 2) vs sidecar `BACKFILL_CONCURRENCY` (default 2) + the budget arithmetic. | **LOW** (doc) | High | 2 (DOC-01..04, AGG-21/22/23/14-doc) | OPEN — scheduled in prior plan-330 Unit A but STILL WRONG at HEAD |
| **AGG-R7-09** | **COR-3 (code-reviewer): home-OG image URL has no on-disk fallback.** `(public)/page.tsx:~104` builds a sized derivative for the social card with no `pickFirstAvailablePhotoBuffer`-style existence check (unlike the per-photo OG route), so a backfilling/legacy `latestImage` yields a 404 social card until backfill catches up. | **LOW** | Medium | 1 (COR-3) | NEW |
| **AGG-R7-10** | **BUG-2 (debugger): `load-more.tsx:~47-86` setState-after-unmount.** An in-flight `loadMoreImages()` resolving post-unmount still runs the setState block; `queryVersionRef` guards stale queries but not unmount. Same class as AGG-R7-02. | **LOW** | High | 1 (BUG-2) | NEW (long-standing) |
| **AGG-R7-11** | **TEST-5: backfill fatal-counters test covers only a single throwing row** (`processed===0`); no MIXED run (`processed>0 && errors>0`), so a regression mis-attributing a fatal row to `processed` survives. **TEST-3:** migration-monotonicity test checks adjacent pairs only, not the real `MAX(created_at)` cursor — idx 8-17 sit below idx 6's `when` yet pass. | **LOW** (test depth) | Med | 1 (test-engineer) | NEW |
| **AGG-R7-12** | **COR-1 (code-reviewer): `home-client.tsx:~280` `containIntrinsicSize` divides by `image.width`** → `Infinitypx` for a 0-width row. Pre-existing, near-impossible given NOT NULL Sharp metadata, but unguarded. | **LOW** | High (theoretical) | 1 (COR-1) | NEW (latent) |

### Architecture / perf observations (mostly justified-as-is; recorded for completeness)

| Agg ID | Finding | Severity | Conf | Disposition |
|---|---|---|---|---|
| **AGG-R7-A1** | ARCH-02: the AGG-5 reserve protects exactly ONE concurrent `getImage` fan-out; 2+ simultaneous visitors during a backfill still queue. The cap is sound; this is an inherent single-pool tradeoff. | MED | High | Mitigation only — record; not a defect |
| **AGG-R7-A2** | PERF-03 (= AGG-14 perf-half): decode-once-per-format via `clone()` would cut decodes ~6× and is SAFE (WI-14 isolation applies to PARALLEL formats, not within-format sequential clones). Deferral partly justified (background-queue CPU, concurrency-1 default). | LOW (perf) | High | DEFER (with corrected justification — the architect refutes "unsafe"; the real reason is scope/CPU-only) |
| **AGG-R7-A3** | PERF-04: `getImage` prev/next range scans run 3 concurrent uncached connections on every photo view (`revalidate=0`) — the live pressure AGG-5 fights. | MED | High | Record — `revalidate=0` is a deliberate freshness choice (CLAUDE.md) |
| **AGG-R7-A4** | ARCH-05: backfill PQueue + live image-queue share libvips capacity with no shared CPU budget; `sharp.concurrency` assumes one image in flight. | MED | Med | Record — single-writer topology; backfill is operator-initiated |

### CRT-2 / data.ts:100 nuance (important for AGG-R7-01 wording)
The AGG-5 header's justification "a single `getImage()` needs 3 SIMULTANEOUS connections" is challenged by the codebase's own `data.ts:100` comment ("the pool serializes execution anyway"). The **formula is correct and the reserve is prudent**, but the comment's causal claim is imprecise — `Promise.all` issues 3 queries that the pool may serialize across fewer physical connections under contention. When fixing AGG-R7-01, state the reserve rationale as "keep headroom so live photo/gallery renders don't queue behind encode-duration connection holds" rather than asserting a hard 3-simultaneous-connection requirement.

---

## VERIFIED-CLEAN (explicitly stress-tested this cycle, NO action)

- **All 19 gates green** (lint, typecheck app+scripts, 3 security lint gates, full vitest).
- **Security (security-reviewer + tracer, hand-verified at HEAD):** AGG-3 EXIF Unicode strip (both halves), AGG-4 `sanitizeForOg` global strip (both sites), session/cookie crypto (`timingSafeEqual` + length pre-check, no oracle), smart-collections deserialization (allowlist + param-bound + scalar-enforced), JSON-LD `</script>` escaping (`safe-json-ld.ts:16`), path-traversal/symlink containment on all three fs-serving routes, byte-level GPS strip (no Sharp `withMetadata()`), all 3 lint-gate invariants confirmed in code (every mutating action returns early on `requireSameOriginAdmin`; exempt getters gate on `isAdmin` or are write-only analytics).
- **npm audit:** 3 HIGH (esbuild via drizzle-kit/tsx) + 2 MODERATE (postcss via next) are ALL build/dev-time only, absent from the prod-deps runtime container; `audit fix --force` would downgrade next and is correctly rejected per the latest-version pin. INFO only.
- **resolveBackfillConcurrency arithmetic (debugger + architect + tracer, machine-verified):** new formula `cap = max(1, floor((limit − max(3,ceil(limit/2)) − 1)/2))` is robust for ALL pathological inputs (poolLimit 0/1/2/NaN/Infinity/negative; requested NaN/0/negative/Infinity) — never 0/negative/NaN; invariant `limit − (1 + 2·cap) ≥ reserved` holds at limit 10/20 and the floor at limit 3. **The CODE is correct; only the surrounding COMMENTS drifted (AGG-R7-01).**
- **`bulkUpdateImages` AGG-8 TriState guard:** shape-guard runs before `.mode` deref (no TypeError→500). DONE.
- **`useDisplayCapability` getSnapshot value-memoization:** cannot regress the React #185 contract.
- **AGG-9 admin error H1 split:** correct in the accessibility tree (sr-only h1 carries the name, aria-hidden glyph, aria-labelledby resolves). The OPEN issue (AGG-R7-03) is the SIGHTED-user visible-heading regression, not the AT tree.
- **AGG-10 home title:** `{absolute}` applied in BOTH metadata branches — double-suffix killed everywhere.
- **Designer fundamentals:** masonry `columns-${n}` safelisted (tailwind.config.ts:11-16, NOT a purge bug); back-to-top correctly triads `aria-hidden`+`tabIndex=-1`+`pointer-events-none`; focus-trapped lightbox; global reduced-motion + forced-colors; enforced 44px touch floor. Double `role="status"` on backfill UI is harmless (sibling regions, never co-announce) — NOT a defect.
- **Stripe webhook mints NO false entitlement for unpaid funds** (correct security posture); the `async_payment_succeeded` gap is the only entitlement issue (AGG-R7-13 below, already-owned).

---

## ALREADY-OWNED / pre-acknowledged (recorded, not newly actionable)

### AGG-R7-13 — Stripe `async_payment_succeeded` never writes an entitlement (HIGH/High · confirmed)
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88,105` handles only `checkout.session.completed` + `payment_status==='paid'`; no `async_payment_succeeded` branch. `apps/web/src/app/api/download/[imageId]/route.ts:166` returns `404 "Token not found"` forever for ACH/bank-transfer settled payments.
- **Agents:** security-reviewer, tracer (TRC-2), critic — corroborated.
- **Disposition:** **ALREADY-OWNED by plan-316 CRT-R5C1-04** and explicitly documented in CLAUDE.md (`entitlements` table note: "only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships"). Per the deferred-fix rule, security/correctness findings may be deferred when the repo's own rules explicitly allow it — CLAUDE.md explicitly scopes payment-method support to card/immediate and assigns the gap to plan-316. No data loss (funds settle in Stripe; the entitlement row is recoverable manually). Interim operator mitigation: disable async payment methods in Stripe Checkout. **Re-confirmed deferred to plan-316; NOT re-owned this cycle.** Exit criterion unchanged: plan-316 picked up, OR a real settled-but-undownloadable ACH purchase is reported → escalate immediately.

---

## AGENT FAILURES

None. All 10 spawned review agents returned successfully on the first attempt.

---

## Summary for PROMPT 2 (planning)

**Genuinely actionable this cycle (12 open + 1 partial):** AGG-R7-01 (stale pool formula ×3 sites — MED, 6 agents), AGG-R7-02 (setTimeout leak — MED), AGG-R7-03 (error-shell visible heading — MED), AGG-R7-04 (remaining aria-describedby — MED), AGG-R7-05 (AGG-9/AGG-10 regression tests — MED), AGG-R7-07 (dropzone aria-disabled — MED), AGG-R7-06 (401/403 deferral note — LOW), AGG-R7-08 (doc drift batch — LOW), AGG-R7-09 (home-OG fallback — LOW), AGG-R7-10 (load-more unmount — LOW), AGG-R7-11 (test depth — LOW), AGG-R7-12 (containIntrinsicSize divide — LOW).

**Plan hygiene (mandatory):** correct the stale plan-329/plan-330 PROGRESS tables to reflect the DONE reality (AGG-8, AGG-10, AGG-13, AGG-16, AGG-18) so no future cycle re-schedules closed work.

**Deferrable (with corrected justification):** AGG-R7-A2 (decode-once perf — LOW, scope/CPU-only, NOT "unsafe"); the arch observations AGG-R7-A1/A3/A4 (inherent single-pool tradeoffs, record-only); AGG-R7-13 (Stripe ACH — already plan-316).
