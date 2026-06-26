# Run-12 Cycle-12 Convergence — Aggregated Review (Cycle 12 of Review-Plan-Fix Loop)

**Date:** 2026-06-27
**HEAD:** 2a9976a1
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0 (perf-reviewer subagent type not registered → covered by a general-purpose agent, as in prior cycles)

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities; npm audit clean (full + prod) |
| HIGH | 0 | The one HIGH claim (critic R12-01) was DISPROVEN on verification — see "Verification Corrections" |
| MEDIUM | 4 | One real shutdown-lifecycle bug, one perf waste, one operational doc drift, one timer-hygiene leak |
| LOW | ~12 | Doc/comment drift, latent API-surface traps, test gaps, minor a11y |

**Verdict:** Mature, well-hardened codebase. The 21 commits since cycle 10 are uniformly positive hardening. This cycle surfaces ONE genuinely deployable bug (graceful-shutdown never exits + spurious timeout warning on every per-iteration Docker deploy) and a cluster of doc/comment accuracy fixes. All three security lint gates PASS; vitest 2065 pass / 4 skipped; tsc + eslint clean (verified independently by verifier + test-engineer).

---

## Verification Corrections (done by the cycle-12 lead, not delegated)

These were verified against the actual installed code before planning:

1. **critic R12-01 (HIGH → DISPROVEN):** Claim was "Next.js 16.2.9 registers its own SIGTERM handler (`start-server.js:376`, `process.exit(143)`) that pre-empts the app's graceful drain." **FALSE.** `grep -rn "SIGTERM"` across the entire `node_modules/next/dist` returns ZERO matches; `NEXT_MANUAL_SIG_HANDLE` is referenced nowhere; the standalone `server.js` only `process.exit(1)`s on startup error. The app's `process.on('SIGTERM', gracefulShutdown)` in `instrumentation.ts:57` IS the active handler and DOES run. The symptom the critic observed (process not exiting cleanly) is real, but the root cause is the missing `process.exit()` + uncleaned sentinel timer (AGG-R12-01), not Next pre-emption. The CLAUDE.md "flushed on graceful SIGTERM" guarantee is therefore intact in principle — the drain runs; it just never exits afterward.
2. **upload-limits default:** `DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES = max(200 MiB, 250 MiB) + 16 MiB = 266 MiB = 278,921,216`. CLAUDE.md documents `279620608`. Confirmed typo (AGG-R12-07).
3. **site-config keys:** `src/site-config.example.json` ships flat **snake_case** (`title`,`url`,`nav_title`,`author`,`home_link`,`footer_text`,`google_analytics_id`). CLAUDE.md deployment checklist documents **camelCase** (`siteName`,`siteUrl`,`navLinks`,`footerLinks`,`social.*`) — a schema that does not exist. Confirmed drift (AGG-R12-03).
4. **smart_collections column:** `schema.ts:297` is `query_json` (not `rules`). Confirmed (AGG-R12-06).

---

## Cross-Agent Agreement Matrix (higher agreement = higher signal)

| Finding | Agents | Severity |
|---------|--------|----------|
| Graceful shutdown never `process.exit()`s + sentinel timer never cleared/unref'd | code-reviewer (CR-01/CR-03), debugger (DBG-01/DBG-04), perf (PERF-6.1), critic (R12-01 symptom) | **MEDIUM** |
| `_verifyAvifNclx` reads whole AVIF into heap to use 4 KB (WebP sibling already fixed) | perf (PERF-1.1) | MEDIUM |
| `hasTrustedSameOriginWithOptions` still exported (AGG-M9 "fix" only moved the export) | code-reviewer (CR-02), security (SEC-01), critic (R12-03), tracer (TRC-01) | LOW (latent) |
| `prioritizeSecurityFields` is an effective no-op + untested | critic (R12-02), test-engineer (TEST-02) | LOW |
| `BoundedMap.entries()` returns raw mutable iterator (inconsistent with `get()` copy) | tracer (TRC-02), debugger (DBG-06), critic (R12-06) | LOW (latent) |
| Stale comment `(5000)` in semantic route (constant is 2000) | verifier (VER-01), document-specialist (CC-01) | LOW |
| db init-race `setTimeout` never cleared on pool-reused connections | debugger (DBG-03) | LOW-MED |

---

## MEDIUM — scheduled for cycle 12

### AGG-R12-01 — Graceful shutdown never exits; sentinel timer leaks (HEADLINE)
- **File:** `apps/web/src/instrumentation.ts:18-50`
- **Evidence:** `gracefulShutdown` sets `process.exitCode = completed ? 0 : 1` (line 49) but never calls `process.exit()`. The MySQL pool holds ref'd connections, so the event loop never drains and the process lingers until Docker's stop-timeout SIGKILL (exit 137). Separately, the 15 s sentinel `setTimeout` (line 22) is never cleared or `.unref()`'d, so on a CLEAN sub-15 s drain it still fires `console.warn('[Shutdown] Timed out after 15s...')` — a false alarm — AND holds the loop alive for the full 15 s.
- **Trigger:** Every per-iteration `npm run deploy` (Docker restart sends SIGTERM).
- **Fix:** capture the timer handle; `clearTimeout` + `.unref()` it; call `process.exit(process.exitCode ?? 0)` after the drain. Agents: 5.

### AGG-R12-02 — `_verifyAvifNclx` full-file read wastes heap
- **File:** `apps/web/src/lib/process-image.ts:246-247`
- **Evidence:** `const buffer = await fs.readFile(filePath)` loads the ENTIRE AVIF derivative (the 7680px AVIF can be multiple MB) only to pass `buffer.subarray(0, 4096)`. The adjacent `_verifyWebpIccChunk` (line 303-316) already does the right thing (`fs.open` + 1 KB partial read, AGG-L5). Under peak fan-out (`QUEUE_CONCURRENCY × 3 formats`) this transiently allocates concurrency × filesize of throwaway buffer.
- **Fix:** mirror the WebP sibling — `fs.open` + `handle.read(head, 0, 4096, 0)` + `finally { handle?.close() }`.

### AGG-R12-03 — CLAUDE.md site-config field names are wrong (operational)
- **File:** `CLAUDE.md` Deployment Checklist step 3 + OG-hardening prose vs `apps/web/src/site-config.example.json`
- **Evidence:** doc says `siteName`/`siteDescription`/`siteUrl`/`authorName`/`navLinks`/`footerLinks`/`social.*`; actual flat keys are `title`/`description`/`url`/`author`/`nav_title`/`home_link`/`footer_text`/`google_analytics_id`. A deployer who hand-writes the config from the doc silently gets blank OG cards + nav.
- **Fix:** rewrite the CLAUDE.md key list to match the shipped example.

### AGG-R12-04 — db init-race `setTimeout` never cleared (timer accrual)
- **File:** `apps/web/src/db/index.ts:88-103`
- **Evidence:** every `getConnection()` whose underlying connection still carries a (already-resolved) `initPromise` creates a fresh 10 s `setTimeout`. After `Promise.race` resolves, the timer is never cleared, so under steady query load up to (query-rate × 10 s) live timers accumulate, each holding the event loop briefly.
- **Fix:** capture the timer; `clearTimeout` in a `finally`; `.unref()`.

---

## LOW — selectively scheduled (cheap) / otherwise deferred

| ID | File | Action |
|----|------|--------|
| AGG-R12-05 | `lib/audit.ts:14` `prioritizeSecurityFields` no-op | SCHEDULE: keep (defensive) + add regression test (TEST-02) |
| AGG-R12-06 | `CLAUDE.md` smart_collections `rules`→`query_json` | SCHEDULE: doc fix |
| AGG-R12-07 | `CLAUDE.md` `NEXT_UPLOAD_BODY_MAX_BYTES` `279620608`→`278921216` | SCHEDULE: doc fix |
| AGG-R12-08 | `api/search/semantic/route.ts:9` `(5000)`→`(2000)`; `image-queue.ts:87` Map.keys()→Set/.values(); `:159` "no eviction"→has eviction | SCHEDULE: comment fixes |
| AGG-R12-11 | `image-queue.ts:181-189` `'queue' in existing` accepts `{queue:null}` | SCHEDULE: strengthen guard to validate `queue`/`enqueued` types |
| AGG-R12-09 | `request-origin.ts:109` `hasTrustedSameOriginWithOptions` exported | DEFER (latent; zero production callers; test locks it) |
| AGG-R12-10 | `bounded-map.ts:115` `entries()` raw iterator | DEFER (latent; zero callers) |
| AGG-R12-12 | `components/search.tsx:375` input `h-8` | DEFER (text input; container provides hit area; out of audit scope) |

---

## Deferred (carry-over / structural — see cycle-12-plan.md "Deferred" for citations + exit criteria)

- Semantic search brute-force O(n) scan (perf PERF-7.1) — acknowledged structural deferral, documented in CLAUDE.md.
- Process-local rate-limit/backfill/view-buffer state vs horizontal scale (architect) — BY DESIGN per CLAUDE.md single-instance topology.
- `lib/storage/*` dead abstraction (architect R12-ARCH-04, critic R12-08) — CLAUDE.md explicitly says NOT integrated; quarantine decision deferred to a product call.
- Shutdown-hook registry / handler-first ordering (architect R12-ARCH-01/02) — larger refactor; partial mitigation lands via AGG-R12-01.
- `data.ts` / `uploadImages` / `processImageFormats` god-module splits (architect, critic) — structural debt, schedule as deliberate paydown.
- Remaining designer a11y LOWs (lightbox swipe `aria-roledescription`, image-zoom forced-colors cursor) — carry-over LOW.
- Remaining test gaps (TEST-01 rate-limit prune timer gate, TEST-03/04/05/06) — schedule where cheap; defer rest.
- decimalToRational subnormal (DBG-05), admin-tokens length-timing (DBG-07) — latent/mitigated.

---

## AGENT FAILURES

None. All 11 agents returned and wrote their per-agent provenance files under `.context/reviews/`.
