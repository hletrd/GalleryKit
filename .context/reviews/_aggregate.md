# Run-14 Cycle-14 Convergence — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 39cfa889
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities; `npm audit --omit=dev` clean (0 vulns) |
| HIGH | 0 | None (TE-02 is a HIGH-priority *test-gate* defect, not a runtime HIGH) |
| MEDIUM | 3 | **C14-01** Next.js standalone registers a competing SIGTERM handler that races the cycle-13 graceful-shutdown fix; **R14-01** `flushBufferedSharedGroupViewCounts` doesn't await an in-flight flush (shutdown truncates in-progress DB writes); **AGG-14-LR-BAVAIL** the cycle-13 `bfree→bavail` fix missed the LR-upload sibling (3-agent agreement). |
| LOW | ~9 | lightbox-color-pip admin-guard sibling miss, icc-extractor mluc bound, argon2 boundary-test seam, tag-input focus-visible, load-more spinner aria-hidden, storage import-guard, broken bavail test gate (TE-02, HIGH-priority), perf index, plus carry-overs. |

**Verdict:** Mature, well-hardened codebase. All 6 blocking gates GREEN (verifier: eslint clean, tsc clean, vitest 2071 pass / 4 skip, lint:api-auth / lint:action-origin / lint:public-route-rate-limit pass). All nine cycle-13 fixes verified individually correct. This cycle's signal is a **cluster around the shutdown/deploy boundary** — the cycle-13 `exec` fix delivered SIGTERM to node, but (a) Next.js installs its own competing SIGTERM→`exit(143)` handler that races the app's flush (C14-01), and (b) the app's own flush returns early when an in-flight flush has already swapped the buffer empty (R14-01) — plus the recurring **"fix one sibling, miss the next"** pattern hitting THREE places this cycle (LR-route `bfree`, lightbox color guard, broken `bavail` test mock).

---

## Verification done by the cycle-14 lead (read against installed code before planning)

1. **AGG-14-LR-BAVAIL — CONFIRMED.** `lr/upload/route.ts:180` `const freeBytes = stats.bfree * stats.bsize;`; `images.ts:211` (cycle-13 fix) uses `stats.bavail`. Two `statfs` sites, now disagree. 3-agent agreement (code-reviewer MEDIUM, security SEC-14-01 LOW, test-engineer TE-01).
2. **C14-01 — CONFIRMED.** `node_modules/next/dist/server/lib/start-server.js:388-390` installs `process.on('SIGTERM', cleanup)` → `process.exit(143)` (line 375-376) unless `NEXT_MANUAL_SIG_HANDLE` is set; `instrumentation.ts:73-80` installs a SECOND SIGTERM handler. `grep NEXT_MANUAL_SIG_HANDLE apps/web` (excl node_modules) → 0 matches. Next version 16.2.9 confirmed. Two competing handlers race on every SIGTERM.
3. **R14-01 — CONFIRMED.** `data.ts:202` `flushBufferedSharedGroupViewCounts` returns when `viewCountBuffer.size === 0`, but `flushGroupViewCounts` swaps `viewCountBuffer = new Map()` at line 101 BEFORE the chunked DB writes on the old `batch` complete. A SIGTERM landing mid-flush sees the empty new buffer and exits, truncating the in-flight writes. No `isFlushing`/in-flight-promise await.
4. **C14-02 / CR-LOW — CONFIRMED.** `lightbox-color-pip.tsx:44,77,173,179` read admin-only `transfer_function`/`color_pipeline_decision` without `isAdmin`; sibling `color-details-section.tsx` was guarded in cycle-13 (`8613e36f`). Safe today (fields undefined for public). 2-agent (code-reviewer, critic).
5. **R14-02 — CONFIRMED, but debugger's proposed fix is WRONG.** `icc-extractor.ts:70` outer guard `dataSize < 12` is shared by BOTH `desc` and `mluc` branches; changing it to `< 16` would reject valid small `desc` profiles. The correct localized fix is a guard INSIDE the mluc branch (`if (dataSize < 16) break;` before the `readUInt32BE(dataOffset+12)` at line 87). Current behavior is already safe (RangeError on a pathological mluc tag at buffer-end is caught by the outer try/catch → returns null = correct fallback); the fix replaces catch-driven control flow with an explicit bound (repo's documented style).
6. **A14-01 — CONFIRMED.** `password-hashing.ts:1` `import * as argon2` is not in the boundary test's native-module allowlist (`client-server-only-boundary.test.ts:263-268`, only sharp/transformers) nor in `serverExternalPackages`. tsx operator scripts import it, so it can't carry `server-only`. Test-only gap.
7. **DES-14-01 — CONFIRMED.** `tag-input.tsx:184` uses `focus:ring-2 focus:ring-ring focus:ring-offset-2` (fires on mouse click); dominant custom-component convention is `focus-visible:ring`. (Note: shadcn ui/ primitives dialog/sheet/upload-dropzone also use `focus:ring`, so this is borderline — aligning the custom component to its peer group.)
8. **DES-14-02 — CONFIRMED.** `load-more.tsx:148` `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` lacks `aria-hidden="true"`.
9. **TE-02 — CONFIRMED (broken regression gate).** `images-actions.test.ts:166` mock supplies `{ bfree, bsize }`; code reads `stats.bavail` → `undefined * 1024 = NaN` → `NaN < 1GiB` = false → the test passes regardless of `bfree`/`bavail`, so the cycle-13 fix has NO real coverage and reverting it is undetectable.
10. **tracer bootstrap re-enqueue — CONFIRMED but design-tradeoff → DEFER.** `image-queue.ts:687` bootstrap pending query is `[eq(images.processed, false)]` with no `processing_error IS NULL`; `permanentlyFailedIds` is in-memory (reset on restart). Permanently-failed images get up to 3 more attempts per restart (bounded). Adding `AND processing_error IS NULL` would also disable a legitimate restart-recovery path for transient failures — design decision, deferred.
11. **PERF-14-01 — CONFIRMED but needs a migration → DEFER (with PERF-13-07).** `analytics-data.ts:167` `getTopSharedGroupsByViews` filters `WHERE bot=false` with only `(groupId, viewed_at)` index → full scan on the admin-only analytics page. Same class as deferred PERF-13-07 (`topicViews`). Requires journal+reconcile+schema migration; admin-only low-traffic surface; deferred consistently.

---

## Cross-Agent Agreement Matrix (higher agreement = higher signal)

| Finding | Agents | Severity |
|---------|--------|----------|
| LR-upload route still uses `bfree` (cycle-13 fix missed sibling) | code-reviewer (MEDIUM), security (SEC-14-01), test-engineer (TE-01) | **MEDIUM** (3 agents) |
| Next.js competing SIGTERM handler races graceful shutdown | critic (C14-01) | **MEDIUM** (headline) |
| `flushBufferedSharedGroupViewCounts` doesn't await in-flight flush | debugger (R14-01) | **MEDIUM** |
| lightbox-color-pip admin fields unguarded (sibling of cycle-13 fix) | code-reviewer (CR-LOW), critic (C14-02) | LOW (2 agents) |
| `bavail` test mock broken (gate non-functional) | test-engineer (TE-02) | LOW/HIGH-priority |

---

## MEDIUM — scheduled for cycle 14

### AGG-14-01 — Next.js competing SIGTERM handler (HEADLINE) — `C14-01`
- **File:** `apps/web/Dockerfile` (runner stage ENV)
- **Fix:** add `ENV NEXT_MANUAL_SIG_HANDLE=true`. Next then skips its `start-server.js:388` handler and only `instrumentation.ts`'s `gracefulShutdown` runs → deterministic view-count flush + correct exit code (0/1, not 143). Verify at deploy via `docker inspect --format '{{.State.ExitCode}}'` (expect 0, not 143).

### AGG-14-02 — LR-upload disk pre-check `bfree`→`bavail` — `AGG-14-LR-BAVAIL` / SEC-14-01 / TE-01
- **File:** `apps/web/src/app/api/admin/lr/upload/route.ts:180`
- **Fix:** `stats.bfree` → `stats.bavail` (mirror `images.ts:211`).

### AGG-14-03 — shutdown flush awaits in-flight flush — `R14-01`
- **File:** `apps/web/src/lib/data.ts` (`flushGroupViewCounts` + `flushBufferedSharedGroupViewCounts`)
- **Fix:** track the in-flight drain in a module-level `currentFlushPromise` (set when a drain starts, resolved/nulled in the existing `finally`); `flushBufferedSharedGroupViewCounts` awaits it before the `size === 0` check, then flushes any post-swap/re-buffered increments.

---

## LOW — scheduled (cheap, clearly correct)

| ID | File | Action |
|----|------|--------|
| AGG-14-04 (TE-02) | `__tests__/images-actions.test.ts:166` | mock `bfree`→`bavail`; add a below-threshold negative test asserting the insufficient-disk error fires (makes the regression gate real) |
| AGG-14-05 (C14-02 / CR-LOW) | `components/lightbox-color-pip.tsx:44,77,173,179` | wrap admin-only `transfer_function`/`color_pipeline_decision` reads in `isAdmin &&` (mirror `color-details-section.tsx`) |
| AGG-14-06 (R14-02) | `lib/icc-extractor.ts:~84` | add localized `if (dataSize < 16) break;` inside the `mluc` branch (NOT the shared outer guard) |
| AGG-14-07 (A14-01) | `__tests__/client-server-only-boundary.test.ts:263-268` | add `argon2` to the native-module allowlist + a pin asserting `password-hashing.ts` is server-only-equivalent |
| AGG-14-08 (A14-02) | new `__tests__/storage-quarantine.test.ts` | fixture asserting no file outside `lib/storage/` + `__tests__/` statically imports `@/lib/storage` |
| AGG-14-09 (DES-14-01) | `components/tag-input.tsx:184` | `focus:ring*` → `focus-visible:ring*` |
| AGG-14-10 (DES-14-02) | `components/load-more.tsx:148` | add `aria-hidden="true"` to the `<Loader2>` spinner |

---

## DEFERRED — recorded, not dropped (bound by repo policy; see cycle-14-plan.md for citations + exit criteria)

- **PERF-14-01 — `sharedGroupViews` missing `(bot, viewed_at)` index** (`analytics-data.ts:167`). Sev MEDIUM. Needs a schema migration (journal monotonic `when` + `reconcileLegacySchema` + `schema.ts`); admin-only low-traffic analytics surface. Same class as deferred PERF-13-07 (`topicViews`). Defer both to a dedicated index-migration cycle. Exit: analytics-page latency regresses, OR a query-perf migration cycle is scheduled.
- **tracer bootstrap re-enqueue** (`image-queue.ts:687`). Sev LOW. Bounded (≤3 attempts/restart); adding `AND processing_error IS NULL` removes a legitimate restart-recovery path for transient failures — design decision. Exit: production shows many `processed=false AND processing_error IS NOT NULL` rows driving repeated re-encode load.
- **PERF-14-02 — `masonryClasses`/`COLUMN_CLASS_MAP` recomputed on scroll re-render** (`home-client.tsx`). Sev LOW micro-opt. Exit: profiling shows it on a hot path.
- **DES-14-03 — position-counter live region announces inner `"2 / 10"` ("2 slash 10") not the descriptive aria-label** (`photo-viewer.tsx:731`, `lightbox.tsx:671`). Sev LOW. `aria.photoPosition` key exists, but the fix restructures a live region across two files; joins the deferred a11y cluster (DES-13-02..06). Exit: an a11y-focused cycle, OR an SR-user report.
- **TE-03/04/05 — additive regression locks** (feed `NULL` author, password-change copy contract, hasColorDetails `isAdmin` formula). Repo norm defers purely-additive coverage. Exit: a regression slips through one of these paths.
- **Carry-overs (unchanged):** SEC-13-02/TRC-13-04 (`hasTrustedSameOriginWithOptions` exported), SEC-13-03 (expensive GET routes not CI-gated), TRC-13-05/AGG-R12-10 (`BoundedMap.entries()` raw iterator), PERF-13-01/02/03 (getTopics MAX subquery / COUNT(*) OVER() / LIKE '%term%'), PERF-13-04/05/06/07, DES-13-02..06 (combobox aria-expanded, accordion motion, theme-toggle, P3 sr-only badge, bottom-sheet aria), R13-ARCH-* structural debt (god-modules, lib/storage integration, single-instance topology BY DESIGN), DBG-05/07 (decimalToRational subnormal, admin-token length-timing). All re-confirmed latent/by-design; see cycle-13-plan.md for original citations + exit criteria.
- **A14-03 / doc LOW** — nginx `/uploads/original/` 404 non-locale-only (app-layer authoritative, no leak); SHARP_CONCURRENCY default-formula doc incompleteness (honest "—"). INFO only.

---

## AGENT FAILURES

None. All 11 agents returned and their per-agent provenance files are under `.context/reviews/` (6 read-only agents' reviews persisted by the lead; 5 writable agents wrote their own).
