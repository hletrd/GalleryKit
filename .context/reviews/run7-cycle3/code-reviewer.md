# Code Reviewer — Run-7 Cycle-3 Deep Review

**HEAD:** `c6eff919` (master)
**Date:** 2026-06-19
**Reviewer:** code-reviewer agent
**Angle:** code-quality / logic / SOLID / maintainability / cross-file invariants
**Scope:** whole repo, focus on `apps/web/src/` (lib, app/actions, app/api, components, db)

---

## Verdict

**NEW actionable findings: 0**

**Recommendation: APPROVE**

This is a mature, heavily-reviewed codebase. The code delta from cycle-2 HEAD (`1cdbb883`) to
this HEAD (`c6eff919`) is purely the two landed cycle-2 fixes (NCLX transfer code 5 → gamma28,
the GPS-toggle wiring test) plus docs and the SW_VERSION stamp — **no new application logic**.

I built a review-relevant file inventory FIRST (80+ lib files, 14 action files, 11 API routes,
db schema/index, 32 components), then examined every high-risk surface directly and fanned out
four parallel Explore agents to cover the remainder. **Every candidate finding surfaced by the
four agents was refuted by reading the actual code** (details in the "Refuted candidates"
section). My own targeted sweeps across the highest-risk surfaces found nothing new and
actionable. A truthful zero is the correct outcome here.

### Gate state (verified this cycle, foreground)
- `npm run typecheck` (app + scripts): **exit 0**
- `npm run lint:api-auth`: **exit 0** (every `/api/admin/**` route wraps `withAdminAuth`)
- `npm run lint:action-origin`: **exit 0** (every mutating server action enforces same-origin)
- `npm run lint:public-route-rate-limit`: **exit 0** (every public mutating route rate-limited or exempt-tagged)

---

## Surfaces examined directly (read in full or in the load-bearing region)

| Surface | File(s) | Assessment |
|---|---|---|
| Color signal detection | `lib/color-detection.ts` (full) | Clean. NCLX maps correct (incl. cycle-1/2 landed fixes); per-field code-2 guard correct; precedence NCLX > ICC-chroma > ICC-name applied per-field; isHdr keyed only on pq/hlg. |
| CSV escape | `lib/csv-escape.ts` (full) | Clean. C0/C1 strip → bidi/zero-width strip → CR/LF collapse → formula-prefix guard (whitespace-tolerant). Tab pre-stripped so removed from formula class (dead-code elimination, correct). |
| Validation layer | `lib/validation.ts` (full) | Clean. `UNICODE_FORMAT_CHARS` exported once + reused; `containsUnicodeFormatting`/`stripUnicodeFormatting` global-twin derived from `.source`; `countCodePoints` for utf8mb4 length; `safeInsertId` BigInt overflow guard. |
| Rate-limit Maps | `lib/rate-limit.ts` + `lib/auth-rate-limit.ts` + `lib/bounded-map.ts` (full) | Clean. Bounded prune (collect-then-delete, oldest-first eviction); XFF parse counts trusted proxies from the right (`validParts.length - hopCount - 1`); 4 documented rollback patterns coherent; DB-backed login bucket + in-memory fast path. |
| Session/auth | `lib/session.ts` (full), `lib/api-auth.ts` (full) | Clean. HMAC verified BEFORE shape assertions (no timing oracle); timing-safe compare w/ length pre-check; token age `> maxAge || < 0`; prod refuses DB-fallback secret. api-auth: token path → same-origin → isAdmin, defense-in-depth headers on both paths. |
| Checkout (money) | `app/api/checkout/[imageId]/route.ts` (full) | Clean. Rate-limit pre-increment + rollback on EVERY early return; strict `/^\d+$/` price parse; code-point-safe title truncation; idempotency-key unknown-IP collision avoidance; card-only pin (AGG-H1). |
| Download (money) | `app/api/download/[imageId]/route.ts` (full) | Clean. Token-shape → hash → lookup → constant-time verify → expiry → refunded → single-use; file open BEFORE atomic claim (no token burn on missing file); handle never leaks on any post-open path; RFC 6266/5987 Content-Disposition. |
| Smart collections | `lib/smart-collections.ts` (compiler + tag + JSON parse) | Clean. All values pass through Drizzle param binding (incl. `between` via `sql` template — parameterized, NOT inlined); per-column operator narrowing; IN bounds; LIKE escape; JSON.parse try-wrapped. |
| Image fan-out | `lib/process-image.ts` (1000-1320) | Clean. Per-format fresh decode (WI-14); rgb16 wide-gamut path; WIDE_GAMUT_MAX_SOURCE_PIXELS downscale to TIFF+keepIccProfile intermediate; **temp intermediate cleaned in `finally` (1312-1317)**; partial sized variants cleaned in `catch`. |
| OG routes | `lib/og-photo-fetch.ts` (full), `lib/og-sanitize.ts` (full), `app/api/og/photo/[id]/route.tsx` (origin) | Clean. Fetch origin pinned to TRUSTED `siteConfig.url` (SSRF closed); byte cap pre+post buffer; shared sanitizer (strip-all global + C0). |
| Queue shutdown | `lib/queue-shutdown.ts` (full) | Clean. Idempotent via `shutdownPromise`; clears GC interval; pause+clear+drain. |
| Fire-and-forget analytics | `app/actions/public.ts` (350-405), `lib/data.ts` (95-129) | Clean. All 4 floating `db.insert/update` sites have explicit `.catch()`; view-count flush chunked + retry-bounded. |

---

## Refuted candidates (agent-surfaced; disproved by direct code reading)

These were raised by the parallel Explore agents and **must NOT be filed as findings** —
each is a false positive verified against the actual source. Recorded so the next cycle does
not re-litigate them.

### REJ-C3-A — gain-map `tmap` URI read "corrupts subsequent record parse" (agent: HIGH) — REFUTED
`lib/gain-map-detection.ts:138-143`. Claim: reading a trailing URI for `tmap` items advances
`pos` and garbles the next record. **False.** The `itemUri` read in `parseInfe` is local to that
function; the caller `parseIinf` advances by **box size** (`pos += header.size`, line 172), not
by the inner read position. The URI read cannot affect record alignment. Additionally a bare
`tmap` only flags via heuristic 1 if it carries the Apple URN (line 258-263); otherwise it defers
to heuristic 2. The read is harmless and intentional (COR-R4C14-02).

### REJ-C3-B — refund-clears-hash "Token not found instead of Refunded" race (agent: MEDIUM) — REFUTED
`app/actions/sales.ts` refund + `app/api/download/[imageId]/route.ts:139-167`. Claim: clearing
`downloadTokenHash` on refund makes a concurrent download hit a misleading 404. **This is
intentional and documented.** The R4C3 COR-R4C3-03 comment (lines 147-153) explicitly states
`refundEntitlement` clears the hash WITHOUT setting `downloadedAt`, so a refunded-never-downloaded
row falls through to an **accurate 404** ("Token not found"), NOT a 410. Once the hash is gone the
server cannot prove the request maps to a refunded purchase vs. a random mistyped token
(privacy-preserving), so 404 is the honest answer. Deliberate design choice, correct.

### REJ-C3-C — `getAdminUsers()` "missing await returns QueryBuilder" (agent: MEDIUM) — REFUTED
`app/actions/admin-users.ts:64`. Claim: the query is not awaited. **False — the agent misread the
code.** Line 64 reads `return await db.select(...).from(adminUsers).orderBy(...)`. The `await` is
present. The function correctly returns resolved rows.

### REJ-C3-D — smart-collections `between` "raw SQL injection" (agent: HIGH) — REFUTED (fix would be HARMFUL)
`lib/smart-collections.ts:225`. Claim: `sql`${col} BETWEEN ${p.lo} AND ${p.hi}`` inlines values
as literals. **False — fundamental misunderstanding of Drizzle's `sql` template tag.** Drizzle
binds every `${value}` interpolation as a parameterized placeholder (`?`) unless `sql.raw()` is
used. So lo/hi are parameter-bound, not injectable. The agent's proposed "fix"
(`sql.raw(String(p.lo))`) would INTRODUCE the very injection it claims to fix. `validateNode` also
enforces `Number.isFinite` for `between` at write time. Already disproved in cycle-2
rejected-candidates ("smart-collections injection").

### REJ-C3-E — download token expiry `>` vs `>=` (agent: LOW) — REJECTED (cosmetic)
`download/route.ts:175`. A 1ms boundary precision claim; negligible, contradicts no real contract.
Not actionable.

### REJ-C3-F..I — speculative "safe today but fragile" observations — REJECTED
analytics country_code defensive re-validation (`analytics.ts:54`), safe-json-ld soft-hyphen escape,
image-queue empty-`notInArray` guard (`image-queue.ts:627`), email-shape RFC-5321 completeness
(`webhook:55`). All are "current code is safe" speculation about hypothetical future regressions or
upstream-guarded inputs (Stripe pre-validation, write-time validators). No live defect. Not
actionable. (The image-queue and country-code items also overlap deferred R7C1-CR-02 / R7C1-CR-03.)

---

## Commonly-missed sweep (final pass)

- **Empty catch blocks:** grep across lib/actions/api → none (all `.catch()` have handlers/comments).
- **Floating async DB ops:** 4 sites, all explicit fire-and-forget analytics with `.catch()` (by design — view counts are documented best-effort).
- **`parseInt` without radix:** none in lib/actions/api (all `, 10`/`, 16`/`, 2`).
- **`JSON.parse` unwrapped:** 3 real call sites (admin-tokens:120, smart-collections:310, semantic:168) — all try/catch-wrapped with graceful fallbacks.
- **Cross-file invariants spot-checked:** `transferFunction` union ↔ NCLX_TRANSFER_MAP ↔ humanizer (cycle-2 fix intact); `COLOR_IMPACTING_KEYS` = 9 (settings-hash); `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic` compile guards present; `tagNamesAgg` shared constant; advisory-lock names; api-auth wrapper coverage.

---

## Positive observations

- The **discovery/refutation discipline** in this repo is exceptional: nearly every non-obvious
  branch carries an inline comment with the lineage tag, the spec citation, and the reason an
  obvious-looking "fix" would be wrong. This is precisely what makes a perfected system stay
  perfected — four independent agents proposed plausible-sounding fixes this cycle and the
  in-code documentation pre-empted all of them.
- **Defense-in-depth symmetry** is consistently applied (shared `UNICODE_FORMAT_CHARS`, shared
  `sanitizeForOg`, the per-field NCLX guard, the derive-don't-copy global-flag regex twins) so a
  single future validator loosening cannot create an asymmetric leak.
- **Money paths** are rigorous: integer cents end-to-end, strict price parse at the read site,
  code-point-safe truncation, idempotency keys with the unknown-IP collision trade-off documented,
  card-only pin closing the async-payment gap operationally, file-open-before-claim so a missing
  file never burns a customer's token.
- **Resource cleanup** is complete on every path examined (temp intermediate in `finally`, partial
  variants in `catch`, file handles closed on every post-open branch, queue drained idempotently).

---

## Summary

- NEW findings by severity: **CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0**
- Agent-surfaced candidates: 9 raised, **9 refuted** (2 would have been harmful to "fix")
- Gate state: typecheck + 3 security lints all exit 0
- **Recommendation: APPROVE** — no new actionable code-quality, logic, SOLID, or maintainability
  defect. A truthful zero.
