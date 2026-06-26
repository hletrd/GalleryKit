# Run-13 Cycle-13 Convergence — Aggregated Review (Cycle 13 of Review-Plan-Fix Loop)

**Date:** 2026-06-27
**HEAD:** 80145992
**Agents:** 11/11 completed (code-reviewer, security-reviewer, perf-reviewer [via general-purpose], critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)
**Agent Failures:** 0 (perf-reviewer subagent type not registered → covered by a general-purpose agent, as in prior cycles)

---

## Convergence Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities; `npm audit` clean (full + prod, 0 vulns) |
| HIGH | 0 | None |
| MEDIUM | 1 real | **R13-01** — Docker SIGTERM never reaches the node process (shell PID-1 without `exec`), nullifying cycle-12's headline shutdown fix on every deploy. Plus 2 MEDIUM doc + 2 MEDIUM a11y. |
| LOW | ~14 | defense-in-depth render guards, rate-limit copy asymmetry, `bfree`/`bavail`, feed username disclosure, a11y polish, perf query-shapes, doc line drift |

**Verdict:** Mature, well-hardened codebase. All 6 blocking gates GREEN (verifier: eslint clean, tsc clean, vitest 2071 pass / 4 skip, lint:api-auth / lint:action-origin / lint:public-route-rate-limit all pass). All cycle-12 fixes verified individually correct and held with no regression. This cycle surfaces ONE genuinely deployable correctness/operational bug at the **Docker process-lifecycle boundary** (R13-01) that silently defeats the prior cycle's marquee work, plus a cluster of cheap doc-accuracy, defense-in-depth, and a11y fixes.

---

## Verification done by the cycle-13 lead (read against installed code before planning)

1. **R13-01 (critic, MEDIUM) — CONFIRMED from source.** `apps/web/Dockerfile:121,124` → `ENTRYPOINT ["entrypoint.sh"]` + `CMD ["sh","-c","node …/migrate.js && node …/server.js"]`; `entrypoint.sh:39` ends `exec gosu node "$@"`. So PID 1 becomes `gosu node sh -c "…"`, gosu execs into the **shell**, and the `&&` prevents shell exec-optimization, so `node server.js` runs as a **child** of a non-interactive `sh` that does not forward SIGTERM. Docker's SIGTERM (every `docker compose up --build` / restart) hits the shell, the node process never receives it, `process.on('SIGTERM', gracefulShutdown)` (`instrumentation.ts`) never runs, and the container is SIGKILLed at `docker-compose.yml:13` `stop_grace_period: 30s` (exit 137). This **directly nullifies cycle-12's AGG-R12-01 fix** in its stated trigger and breaks the CLAUDE.md "view-count buffer flushed on graceful SIGTERM" guarantee on every deploy. Canonical one-word fix: `… && exec node …/server.js`.
2. **DOC-13-01 — CONFIRMED.** `api-auth.ts:14` `TOKEN_HEADER = 'x-gallerykit-token'`; CLAUDE.md:147 documents `X-Admin-Token`. Plugin developers following the doc get 401s.
3. **DOC-13-02 — CONFIRMED.** `admin-tokens.ts:19-22,48-52` issues `gk_<base64url(32 bytes)>` = 46 chars (prefix 3 + 43 base64url); CLAUDE.md:147 says "32-char random hex string."
4. **DBG13-01 — CONFIRMED.** `images.ts:206` uses `stats.bfree * stats.bsize`; `bfree` counts root-reserved blocks the non-root `node` user cannot allocate → pre-check can pass then `ENOSPC` at writeFile. Should be `bavail`.
5. **SEC-13-01 — CONFIRMED.** `data.ts:792` `getImagesForFeed` selects `author_name: adminUsers.username` (the admin **login** username), emitted as per-entry `<author><name>` on the public Atom feed. The route already falls back to feed-level `<author>` when `author_name` is NULL (`data.ts:785-786`), so dropping the username selection closes the disclosure cleanly.
6. **TRC-13-02/03 — CONFIRMED (currently safe).** `color-details-section.tsx:221` (`hasColorDetails`) and `:393` reference admin-only `transfer_function`/`is_hdr` without an `isAdmin` guard. Safe today because both are omitted from `publicSelectFields` (undefined for public viewers), but inconsistent with the explicit AGG-M3 `isAdmin && …` convention in the same file → maintenance trap.
7. **PERF-13-01 — DISPROVEN as a new bug.** `data.ts:461-467` already carries an explicit comment acknowledging the per-topic `MAX(updated_at)` correlated subquery as "cheap at gallery scale" bounded by the `revalidate=3600` ISR sitemap cache. Documented tradeoff, not a regression → defer.

---

## Cross-Agent Agreement Matrix (higher agreement = higher signal)

| Finding | Agents | Severity |
|---------|--------|----------|
| Docker SIGTERM never reaches node (shell PID-1, no `exec`) | critic (R13-01) | **MEDIUM** (headline) |
| `getPasswordChangeRateLimitEntry` returns raw entry vs sibling `{...entry}` | code-reviewer (CR-13-01), debugger (DBG13-02) | LOW |
| `color-details-section` render gates use admin-only fields without `isAdmin` | tracer (TRC-13-02/03) | LOW (defense-in-depth) |
| `hasTrustedSameOriginWithOptions` still exported (carry-over AGG-R12-09) | security (SEC-13-02), tracer (TRC-13-04) | LOW (latent, deferred) |
| CLAUDE.md admin-token header/format wrong | document-specialist (DOC-13-01/02) | MEDIUM (operational doc) |
| `BoundedMap.entries()` raw iterator (carry-over AGG-R12-10) | tracer (TRC-13-05 INFO) | LOW (latent, deferred) |

---

## MEDIUM — scheduled for cycle 13

### AGG-R13-01 — Docker SIGTERM never reaches node (HEADLINE) — `R13-01`
- **File:** `apps/web/Dockerfile:124`
- **Fix:** `CMD ["sh","-c","node apps/web/scripts/migrate.js && exec node apps/web/server.js"]` (add `exec`). After migrate completes, the shell replaces itself with node so node becomes PID 1 and receives SIGTERM directly → gracefulShutdown runs → view-count buffer flush honored, clean exit 0, no 30 s SIGKILL wait on every deploy. (Alternative `init: true` in compose was considered; `exec` is the minimal, idiomatic fix and keeps migrate-then-serve ordering.)

### AGG-R13-02 — CLAUDE.md admin-token header + format wrong — `DOC-13-01`, `DOC-13-02`
- **File:** `CLAUDE.md` admin_tokens row (~line 147)
- **Fix:** `X-Admin-Token` → `X-GalleryKit-Token` (case-insensitive `x-gallerykit-token`); "32-char random hex string" → "`gk_<base64url(32 random bytes)>` = 46 chars (prefix + 43 base64url), stored SHA-256-hashed."

### AGG-R13-03 — aria-describedby points at a display:none element — `DES-13-01`
- **File:** `apps/web/src/components/photo-viewer.tsx` (shortcuts paragraph, `hidden md:block`)
- **Fix:** `hidden md:block` → `sr-only md:not-sr-only` so the `aria-describedby` target stays in the a11y tree on mobile (resolves to empty string today on mobile → SR announces no description).

---

## LOW — scheduled (cheap, clearly correct)

| ID | File | Action |
|----|------|--------|
| AGG-R13-04 (`DBG13-01`) | `app/actions/images.ts:206` | `stats.bfree` → `stats.bavail` (root-reserved blocks) |
| AGG-R13-05 (`CR-13-01`/`DBG13-02`) | `lib/auth-rate-limit.ts:114` | `return entry;` → `return { ...entry };` (match login-sibling copy contract) |
| AGG-R13-06 (`TRC-13-02`/`03`) | `components/color-details-section.tsx:221,393` | wrap admin-only `transfer_function`/`is_hdr` reads in `isAdmin &&` (AGG-M3 convention; no-op for current behavior, closes trap) |
| AGG-R13-07 (`SEC-13-01`) | `lib/data.ts:792` | stop selecting `adminUsers.username` for the public Atom feed; fall back to feed-level `<author>` (already supported) |
| AGG-R13-08 (`DES-13-07`) | `components/load-more.tsx:147` | `h-11` → `min-h-11` (match floor convention; avoid label clip) |
| AGG-R13-09 (`DOC-13-03`/`04`, `DBG13-05`) | `CLAUDE.md`, `lib/data.ts:147` | line-cite drift (`process-image.ts:1131-1135`→1157, `settings-hash.ts:41-53`→42-54) + comment `FLUSH_CHUNK_SIZE = 20`→`5` |

---

## DEFERRED — recorded, not dropped (bound by repo policy; see cycle-13-plan.md for citations + exit criteria)

- **SEC-13-02 / TRC-13-04 / AGG-R12-09** — `hasTrustedSameOriginWithOptions` exported (`request-origin.ts:109`). LOW latent; zero production callers; test-locked. Carry-over.
- **SEC-13-03** — expensive public GET routes (`search/similar`, both OG) rate-limited at runtime but not CI-gated. LOW/informational; carry-over.
- **TRC-13-05 / AGG-R12-10** — `BoundedMap.entries()` raw iterator (`bounded-map.ts:115`). LOW latent; zero callers. Carry-over.
- **PERF-13-01..07** — getTopics N+1 (documented ISR-cached tradeoff), `COUNT(*) OVER()` pagination, `LIKE '%term%'` substring search (needs FULLTEXT), 4× LOW micro-opts. Structural / modest-scale; repo norm defers structural perf.
- **DES-13-02..06** — aria-expanded combobox semantics (MED, combobox-risk), accordion motion, theme-toggle state-in-label, P3 sr-only badge, bottom-sheet 3-state aria (the last 3 need new en+ko i18n keys). LOW/MED a11y polish.
- **R13-ARCH-01** — caption-stub feeds public alt-text fallback under an "AI" banner without an HDR-style honesty guard. LOW; mitigated (data layer strips stub prefix; default-off toggle; alt-text only).
- **R13-ARCH-02..08 / R13-ARCH-10** — deferred-feature scaffolding policy, `data.ts`/`processImageFormats`/`uploadImages` god-module splits, shutdown-hook registry, `lib/storage/*` quarantine, view-buffer extraction. Structural debt; single-instance topology BY DESIGN per CLAUDE.md.
- **TEST-01/05/06 + NEW-01/02/03 + GAP-01/02** — additive coverage (rollbackOgAttempt behavioral, bootstrap first-scan-empty named test, prune timer-gate negative path, shutdown/db timer locks, formatShutterSpeed, safeUnlink, queue shape-guard, bounded-map entries). Repo norm defers additive tests.
- **DBG-05 / DBG-07** — decimalToRational subnormal, admin-token length-timing. LOW; not reachable with real inputs. Carry-over.

---

## AGENT FAILURES

None. All 11 agents returned and wrote their per-agent provenance files under `.context/reviews/`.
