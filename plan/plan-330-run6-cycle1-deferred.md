# Plan 330 — Docs batch + Deferred + Coverage Accounting (Run-6 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (25 deduped findings).
**Coverage rule:** every one of the 25 aggregate findings is either scheduled in plan-328 / plan-329 / this plan's docs batch, or explicitly deferred below with file:line citation, ORIGINAL severity/confidence (never downgraded), a concrete deferral reason, and an exit criterion.
**Repo rules consulted before any deferral (in order):** CLAUDE.md (root), AGENTS.md (via CLAUDE.md "Git Workflow"), `.context/` conventions, global CLAUDE.md (destructive-action safety, latest-version, GPG-sign). **No security, correctness, or data-loss finding is deferred** — the two security-class findings (AGG-3, AGG-4) are SCHEDULED in plan-328 items 3-4; the HIGH correctness regression (AGG-1) is plan-328 item 2.

---

## Coverage accounting (25 findings)

| Plan | Finding IDs |
|---|---|
| plan-328 (HIGH + security + gate) | AGG-1, AGG-2 (+AGG-15 folded), AGG-3, AGG-4, AGG-6, AGG-7 |
| plan-329 (MED a11y/correctness/perf) | AGG-5, AGG-8, AGG-9, AGG-10, AGG-11, AGG-16 |
| plan-330 docs batch (below, Unit A) | AGG-14 (doc half), AGG-21, AGG-22, AGG-23 |
| plan-330 code-comment batch (Unit B) | AGG-19, AGG-20 |
| **plan-330 deferred (below)** | **AGG-12, AGG-13, AGG-14 (perf half), AGG-17, AGG-18, AGG-24, AGG-25** |
| **Total** | **25 / 25 ✓** |

Notes on splits:
- **AGG-14** is split: the doc-correction half (CLAUDE.md overstates "single Sharp instance with clone()") is SCHEDULED in Unit A; the perf-optimization half (decode-once-clone-across-sizes) is DEFERRED (entry 3) because fresh `sharp()` per format is deliberate cross-format-contamination defense (WI-14) and changing the per-size decode is a non-trivial pipeline change.
- **AGG-13** (semantic-mode blank Select) is a still-open plan-325 item-5 LOW; it remains OWNED by plan-325 and is recorded here as deferred-to-plan-325 (entry 2) rather than re-scheduled, to avoid double-ownership.

---

## Unit A — CLAUDE.md + plan-326 truth corrections (one docs commit)

| Finding | Where | Correction |
|---|---|---|
| AGG-21 (LOW, DOC-1) | CLAUDE.md ETag/cache section (~line 260) + plan-326 DOC-R5C3-01 line | `COLOR_IMPACTING_KEYS` in `settings-hash.ts:34-46` has **9** keys, not 3 (CLAUDE.md) or 5 (plan-326). Quality/size changes ALSO bust the serve-upload ETag. Correct CLAUDE.md to list the real 9-key set (or say "all 9 color/quality/size-impacting keys; see `COLOR_IMPACTING_KEYS`") and annotate plan-326's stale "5" with a `[CORRECTION run-6]` note (do not rewrite history). |
| AGG-22 (LOW, DOC-3) | CLAUDE.md "Backfill" / Admin tunables | Add the connection-budget arithmetic now in the runner header, and distinguish the two env vars: in-app `ADMIN_BACKFILL_CONCURRENCY` (clamped to the pool-budget cap, see plan-329 item 4) vs the sidecar `BACKFILL_CONCURRENCY` (default 2, uncapped — runs in a `--rm` container with its own pool). |
| AGG-23 (LOW, DOC-2) | CLAUDE.md (process-image.ts row) | `IMAGE_PIPELINE_VERSION = 7` is DEFINED in `gallery-config-shared.ts:21` and re-exported via process-image.ts; attribute the definition correctly (value 7 is correct). |
| AGG-14 doc half (LOW) | CLAUDE.md "Image Processing Pipeline" step 6 | "Single Sharp instance with `clone()` (avoids triple buffer decode)" describes the per-FORMAT clone but the encoder opens a fresh `sharp(inputPath,…)` per output SIZE (deliberate, WI-14 cross-format isolation). Correct the wording so it does not overstate decode reuse. |

## Unit B — code-comment honesty batch (one commit)

| Finding | Where | Change |
|---|---|---|
| AGG-19 (LOW) | `apps/web/src/lib/admin-backfill-runner.ts` (state.lastError write site) | Comment: at concurrency>1, `state.lastError` is last-writer-wins across workers — the failure COUNTS stay correct (each worker increments its own tally), only the single scalar error MESSAGE reflects whichever worker wrote last. Acceptable; documented so a future reader doesn't treat lastError as a per-row log. |
| AGG-20 (LOW) | `apps/web/src/app/actions/admin-backfill.ts` (`triggerAdminBackfill`) | Comment: the count-then-handoff is a benign TOCTOU — if a restore lands between the candidate count and the runner's first loop iteration, the UI may briefly report "queued N" while the runner no-ops; self-healing on the next status poll. |

---

## Deferred findings (7 entries)

### 1. AGG-12 / TRC-3 — Stripe `checkout.session.async_payment_succeeded` never writes an entitlement (HIGH)
- **Original severity/confidence:** HIGH / High · confirmed (tracer + critic).
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88` (only `checkout.session.completed` handled); `apps/web/src/app/api/download/[imageId]/route.ts:166` (404 "Token not found" forever for ACH/bank-transfer settled payments).
- **Reason for deferral — repo rule quoted:** This finding is **already owned and explicitly documented** by the repo. CLAUDE.md (root) `entitlements` table note states verbatim: *"`checkout.session.async_payment_succeeded` is not yet handled — delayed payment methods (bank transfer / ACH) complete checkout but never receive an entitlement row; only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships."* It is therefore a repo-acknowledged, scoped limitation tracked under plan-316, not a newly-discovered unmanaged defect. Per the deferred-fix rule, security/correctness findings may be deferred when "the repo's own rules explicitly allow it" — here CLAUDE.md explicitly scopes payment-method support to card/immediate and assigns the gap to plan-316. This cycle does not re-own it; it remains plan-316's item. (No data loss: the customer's funds settle in Stripe; the missing artifact is the local entitlement row, recoverable by manually granting once the handler ships or via the Stripe dashboard.)
- **Exit criterion:** plan-316 CRT-R5C1-04 is picked up for implementation (add an `async_payment_succeeded` handler writing the entitlement, idempotent against `completed`), OR an operator reports a real settled-but-undownloadable ACH purchase → escalate to an active plan item immediately (HIGH, not deferrable further once a real customer is affected).

### 2. AGG-13 / COR-3 — semantic-mode `<Select value>` renders blank on legacy `'production'` (LOW)
- **Original severity/confidence:** LOW / High · confirmed.
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:~602`.
- **Reason for deferral:** Already OWNED by plan-325 item 5 (`AGG-R5C3-13`), which is a still-open item from the prior cycle with a precise prescription (coerce `['disabled','stub'].includes(v) ? v : 'disabled'`, keep the amber legacy warning reading the RAW map). Re-scheduling it in a run-6 plan would create double-ownership of the same one-line fix. LOW severity, no security/correctness/data-loss (a blank trigger is cosmetic; the underlying stored value is unchanged and the amber legacy warning still surfaces).
- **Exit criterion:** plan-325 item 5 is executed, OR the semantic-mode Select is next touched for any reason → apply the value coercion then.

> **[CORRECTION run-7 — AGG-R7 plan hygiene, from code-reviewer + critic]** This is now **DONE** at HEAD, not deferred. The value-coercion is present at `settings-client.tsx:622` (the line drifted from the ~602 cited here). No further action — do NOT re-schedule.

### 3. AGG-14 (perf half) / PERF-N2 — per-size full source re-decode in the encoder (LOW)
- **Original severity/confidence:** LOW / High · confirmed.
- **Where:** `apps/web/src/lib/process-image.ts:~1045-1090` — fresh `sharp(inputPath,…)` per output size; only same-`resizeWidth` outputs hard-link-dedup → up to ~18 full decodes per image (sizes × formats).
- **Reason for deferral:** LOW severity (background-queue CPU only, concurrency-1 by default; does not affect request latency). The fresh per-format `sharp()` is a DELIBERATE correctness defense against shared-state cross-format contamination (CLAUDE.md WI-14: "Per-format fresh `sharp(inputPath, …)` to eliminate shared-state cross-format contamination"). Decode-once-clone-across-sizes risks re-introducing exactly that bug and interacts with the rgb16 wide-gamut pipeline branching; it is a non-trivial pipeline change with its own correctness considerations, not a drive-by. The doc-correction half ships this cycle (Unit A). Not security/correctness/data-loss.
- **Exit criterion:** the encoder fan-out is next refactored for any reason, OR encode CPU becomes a measured production bottleneck (operator report / queue backlog) → evaluate decode-once-clone-across-sizes WITHIN a format (preserving the per-format isolation), with a test pinning no cross-format contamination.

### 4. AGG-17 / TEST-5 — `withAdminAuth` wrong-scope 403 branch unpinned (LOW test)
- **Original severity/confidence:** LOW / Med · likely.
- **Where:** `withAdminAuth` wrong-scope branch returns 403 (some prior plan text said 401); no test pins the status.
- **Reason for deferral:** LOW / Med. The auth wrapper's PRESENCE is already enforced by the `lint:api-auth` blocking gate (every admin route must wrap `withAdminAuth`); the un-pinned detail is only the exact status CODE of the wrong-scope branch. No security gap (wrong-scope IS rejected; 403 vs 401 is a correctness-of-status nicety). Not data-loss/correctness-of-behavior.
- **Exit criterion:** the `withAdminAuth` status semantics are next changed, OR a route relies behaviorally on the 401-vs-403 distinction → add a test asserting the wrong-scope branch returns 403 and correct any stale plan/doc text.

> **[CORRECTION run-7 — AGG-R7-06, from critic CRT-5 + test-engineer TEST-4]** This entry's 401-vs-403 framing was WRONG. Verified against `apps/web/src/lib/api-auth.ts`: the token wrong-**scope** branch returns **401** (line 85) and IS already pinned by `api-auth-response-headers.test.ts:103` ("a VERIFIED token with the WRONG scope yields a no-store 401"). **403** is the cross-**origin** (CSRF) branch (line 95), which is NOT yet pinned by a status test. So: do NOT write a test asserting 403-for-wrong-scope — it would contradict the existing passing 401 test. The genuinely-unpinned item is only the cross-origin **403** status (re-recorded as plan-332 deferred entry #6, LOW). The wrong-scope status need not be re-tested (already covered). No security gap either way: both branches reject; the codes differ by branch (401 unauthenticated/wrong-scope vs 403 forbidden-origin).

### 5. AGG-18 / TEST-3/4 — 5 advisory-lock name constants unpinned; `upload-paths` branch only mocked (LOW test)
- **Original severity/confidence:** LOW / Med · likely.
- **Where:** advisory-lock name constants (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`) — only 1 pinned; `upload-paths` branch logic exercised only via mocks.
- **Reason for deferral:** LOW / Med. A changed lock-name constant fails LOUDLY at runtime the first time two ops serialize (a renamed lock simply stops serializing — caught by the existing concurrent-restore / concurrent-backfill behavioral tests for the locks that ARE pinned). The unpinned constants are string literals whose drift is low-probability and not silent in production for the actively-exercised locks. Not security/correctness/data-loss (the locks themselves are tested behaviorally where it matters).
- **Exit criterion:** any advisory-lock name is next renamed, OR a new advisory lock is added → add a fixture pinning all 6 lock-name constants in the same pass; add a non-mocked `upload-paths` branch test when the upload-path resolution logic is next touched.

> **[CORRECTION run-7 — AGG-R7 plan hygiene, from verifier + test-engineer]** This is now **DONE** at HEAD, not deferred. All 6 advisory-lock name constants are pinned across `src/__tests__/advisory-locks.test.ts`, `admin-delete-lock-source.test.ts`, and `restore-upload-lock.test.ts` (verified: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing` all appear), and a non-mocked `upload-paths` branch test exists. No further action.

### 6. AGG-24 — designer LOW a11y/UX cluster (LOW)
- **Original severity/confidence:** LOW / mixed (High for DES-04/DES-08, Med for DES-06/DES-07) · designer.
- **Where:** DES-04 double `role="status"` on the backfill UI (`settings-client.tsx` last-run div + an inner element); DES-06 `aria-disabled` dropzone honesty; DES-07 error-shell heading-level inconsistency; DES-08 stale skip-link comment.
- **Reason for deferral:** LOW cosmetic-a11y polish. DES-04 (double `role=status`) is harmless redundancy (a screen reader announces the region once; the duplicate does not create a focus trap or block content). DES-06/07/08 are non-blocking nicety. None affects WCAG conformance at A/AA in a way that blocks task completion (the content is reachable, labeled, and operable). NOTE: AGG-9 (admin error H1 contrast, plan-329 item 1) is the one error-shell a11y issue with real impact and IS scheduled — DES-07's heading-LEVEL nicety rides along naturally when that file is edited. Not security/correctness/data-loss.
- **Exit criterion:** the backfill settings UI is next edited (DES-04/DES-08 — drop the duplicate `role=status` and the stale comment opportunistically, e.g. during plan-328 item 2's UI change), OR a focused a11y audit prioritizes the cluster. DES-07 closes when plan-329 item 1 touches the error shells.

### 7. AGG-25 / SEC-N3 — 2 moderate transitive `postcss` advisories via Next toolchain (INFO)
- **Original severity/confidence:** INFO / High · security-reviewer.
- **Where:** transitive `postcss` pulled by the Next.js build toolchain (dev/build-time, not runtime request path).
- **Reason for deferral — repo rule quoted:** Build-time-only transitive advisory with no runtime request-path exposure (PostCSS runs at build, not on user requests). The global CLAUDE.md "Always Use Latest Versions" rule mandates latest STABLE Next; `npm audit fix --force` would force-bump Next off its pinned stable major, contradicting that rule and the project's "Next.js 16.2" pin. The advisory is not runtime-exploitable in a self-hosted gallery whose build is trusted. Per the deferred-fix rule, this is an aggregator-classified dependency note, not an open application vulnerability.
- **Exit criterion:** Next.js ships a stable release whose toolchain bumps `postcss` past the advisory (adopt it per the latest-version rule on the normal upgrade cadence), OR a runtime PostCSS exposure is demonstrated. Do NOT `audit fix --force`.

---

## Progress

| Unit / Entry | Commit | Status |
|---|---|---|
| Unit A (docs) | — | TODO |
| Unit B (code comments) | — | TODO |
| Deferred 1-7 | n/a (recorded) | RECORDED |
