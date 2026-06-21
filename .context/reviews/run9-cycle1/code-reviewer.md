# Code Reviewer — Run-9 Cycle-1 (HEAD `d3858cfc`)

**Date:** 2026-06-21
**Reviewer angle:** Fresh, skeptical whole-repo code-quality / logic / edge-case / error-handling / SOLID / data-flow sweep of `apps/web/src` — deliberately NOT removal-blast-radius-focused (run-8 c1/c2 already did that exhaustively). This cycle widened the lens to the files the removal-centric cycles under-examined, with strong attention to binary parsers, the keyset-pagination cursor, the background-queue race/lock surface, auth/rate-limit boundaries, and React hook lifecycles.

**Code state:** byte-identical to converged `f63af3b9`. The only commit since (`d3858cfc`) is the run-8 c2 review-artifact doc commit — `git diff f63af3b9..HEAD` is 12 markdown files under `.context/reviews/run8-cycle2/`, **zero source changes**. The repo has converged TWICE recently (run-7 c6, run-8 c2).

## NEW FINDINGS: 0

**Verdict: APPROVE.** A deep, honest, whole-repo sweep surfaced zero new actionable correctness / security / data-loss / logic / edge-case / error-handling / invariant findings. Convergence holds. Four candidate findings were raised during the sweep; **all four were REFUTED by direct code reading** (details below) — none reached the bar of an actual defect. Per the convergence convention, the correct outcome is NEW_FINDINGS:0 / COMMITS:0; manufacturing a finding to look productive would be the failure mode here.

---

## Method (evidence of coverage, not a sample)

Built a review-relevant inventory first: **225 non-test `.ts`/`.tsx` files** under `apps/web/src` (38,834 LOC). Fanned out **8 parallel deep-read agents**, each assigned a distinct, non-overlapping slice and instructed to READ full file contents (not grep) and hunt specific defect classes. Together the 8 slices covered every high-value lib, all 13 server actions, all 8 API routes, the migration/SW/restore infra, and the 13 largest/highest-risk components. I then **personally re-derived every candidate finding from source** rather than trusting agent summaries.

| Slice | Files | Defect classes hunted | Result |
|---|---|---|---|
| Binary/EXIF/ICC/ISOBMFF parsers | color-detection, icc-chromaticity, icc-extractor, gain-map-detection, color-pipeline-decisions, color-primaries, gps-exif-strip, exif-datetime | bounds-before-read, int overflow on offsets, unbounded loops, endianness, div-by-zero, malformed-box infinite loop, attacker-length allocation | **0** |
| Server actions | images, topics, tags, sharing, collections, admin-users, settings, seo, embeddings, lr-tokens, admin-backfill, auth, public | missing auth/origin guard, TOCTOU, txn boundaries, partial-failure, input validation, SQL from untrusted input, last-admin lockout | **0** |
| Processing pipeline + queue | process-image (1650 LOC), image-queue, admin-backfill-runner, process-topic-image, queue-shutdown, view-retention, upload-tracker(-state) | delete-during-processing race, lock-release-on-error (finally), conn leak, orphaned files on affectedRows==0, Promise.all partial failure, concurrency budget, SIGKILL consistency | **0** |
| Data layer + API routes | data (1660 LOC), data-timeline, serve-upload, settings-hash, atom-feed, og/photo, og, search/semantic, search/similar, admin/db/download, admin/lr/upload, health | PII leak into public path, NULL-returning subquery, pagination bounds, NaN route params, admin-route auth wrap, public-mutating rate limit, ETag/cache, internal leak in error body | **0** |
| Auth / rate-limit / sanitize | session, password-hashing, auth-rate-limit, rate-limit, bounded-map, api-auth, action-guards, request-origin, admin-tokens, validation, sanitize, csv-escape, og-sanitize, proxy | timing-unsafe token compare, rate-limit bypass/boundary, bounded-map eviction logic, origin bypass, Trojan-Source/CSV bypass, HMAC verify, session expiry boundary, ReDoS, middleware path-match bypass | **0** (2 candidates refuted) |
| React components | photo-viewer, lightbox, histogram, image-zoom(+math), use-display-capability, info-bottom-sheet, color-details-section, lightbox-color-pip, upload-dropzone, search, home-client, load-more | useEffect stale-closure/missing-dep/infinite-loop, useSyncExternalStore unstable snapshot (#185), listener leak, setState-after-unmount, canvas/worker leak, pagination off-by-one, div-by-zero in math | **0** (1 candidate refuted) |
| Migration / SW / restore infra | migrate.js, db-restore, sql-restore-scan, db-actions, advisory-locks, upload-processing-contract-lock, restore-maintenance, sw.template.js, sw-cache, smart-collections, mysql-datetime, mysql-cli-ssl, base56, backup-filename, download-filename | journal cursor/hash skip, reconcile idempotency, lock acquire-without-release, restore-dump validation bypass, CLI command injection, SW LRU off-by-one, smart-collection SQL inj / unbounded recursion, filename collision/traversal, ReDoS | **0** |
| Remaining libs + CLIP | clip-embeddings, clip-inference, clip-model(-id/-paths), analytics(-data), audit, tag-records, tag-slugs, gallery-config(-shared), upload-limits/paths/filenames, blur-data-url, safe-json-ld, content-security-policy, csp-nonce, photo-title, caption-generator | float32 decode/normalize NaN, cosine div-by-zero, config validator gap, upload limit off-by-one, JSON-LD inj, CSP nonce reuse/weakness, audit truncation, analytics SQL | **0** (1 candidate refuted) |

**Gate evidence at HEAD (foreground runs):** `npm run typecheck` (app via `tsconfig.typecheck.json` incl. `__tests__/` + `typecheck:scripts`, 7 JS files) → **exit 0**. Focused vitest (`privacy-fields`, `data-tag-names-sql`, `auth-rate-limit-ordering`, `view-retention`) → **35/35 passed**.

---

## Candidate findings raised and REFUTED on direct code read (provenance — do not re-litigate)

These were surfaced by the fan-out agents as "POTENTIAL"/"Medium". I read each from source and disproved it. Recording so the next cycle doesn't re-raise them.

1. **`auth-rate-limit.ts:133` `PASSWORD_CHANGE_MAX_ATTEMPTS` "orphaned / never enforced"** — **REFUTED.** It is imported at `auth.ts:15` and ENFORCED: in-memory check at `auth.ts:340` (`if (limitData.count >= PASSWORD_CHANGE_MAX_ATTEMPTS)`) and DB-backed check at `auth.ts:357-358` (`checkRateLimit(..., PASSWORD_CHANGE_MAX_ATTEMPTS, ...)` + `isRateLimitExceeded(...)`), with a source-contract pin in `auth-rate-limit-ordering.test.ts:94`. The constant is fully wired. (The only nit is the doc comment at `:132` sitting above the `const` rather than the `prune` function — pure cosmetic, zero behavioral impact, NOT a finding.)

2. **`load-more.tsx:51` `mountedRef` "reads undefined during the pre-mount window"** — **REFUTED.** `mountedRef` is initialized to `true` at declaration (`load-more.tsx:36` `useRef(true)`), so `mountedRef.current` is `true` from first render — never `undefined`. The unmount-guard `useEffect` (`:133-138`) re-affirms `true` on mount and flips `false` on cleanup. The IntersectionObserver that triggers `loadMore` is attached via a ref callback (`:110-127`) that cannot fire before mount. The guard at `:51` (`!mountedRef.current`) and the symmetric one at `:88` work correctly. The agent's "reads undefined" premise is factually wrong.

3. **`session.ts:145` session-expiry boundary "off-by-one, accepts token at exact expiry"** — **REFUTED.** `if (session.expiresAt < new Date())` is the correct, standard fail-safe: a sub-millisecond acceptance at the exact expiry instant is the conventional boundary and is harmless. Defense-in-depth 24h max-age also applies at `:132` (`tokenAge > maxAge || tokenAge < 0`, with a clock-skew negative guard). No defect.

4. **`csp-nonce.ts` / `content-security-policy.ts:97` CSP nonce "could contain invalid chars / be reused"** — **REFUTED twice.** The nonce is generated per request in middleware at `proxy.ts:41` as `crypto.randomUUID().replace(/-/g, '')` → exactly 32 lowercase hex chars `[0-9a-f]`. (a) No path can introduce a space/quote, so the hypothetical CSP-breaking `'nonce-"foo bar"'` cannot occur — no escaping needed. (b) `randomUUID()` runs per request, so the nonce is unique per request — not reused. `getCspNonce` correctly reads the per-request `x-nonce` header.

---

## Spot-validations I did personally (confirming agent CLEAN verdicts, not rubber-stamping)

- **Keyset pagination cursor** (`data.ts:685-708` `buildCursorCondition` vs `:738` `ORDER BY desc(capture_date), desc(created_at), desc(id)`): re-derived against MySQL NULLs-last DESC ordering. Dated-cursor branch correctly treats all `isNull(capture_date)` rows as "after" (they sort last); null-cursor branch correctly restricts to other null-dated rows via the `isNull` guard. Full tie-break chain (capture_date → created_at → id) — **no duplicate or skipped rows**. The prev/next adjacency at `:1000-1045` mirrors the same shape symmetrically (gt for "after", lt for "before"). `normalizeImageListCursor` (`:658-683`) validates id is a positive integer, capture_date against `MYSQL_DATETIME_CURSOR_RE`, created_at against ISO/MySQL datetime REs with length caps — robust against a hostile cursor. CLEAN.
- **Hourly GC** (`image-queue.ts:695-718`): each purge (`purgeExpiredSessions`/`purgeOldBuckets`/`purgeOldAuditLog`/`purgeOldViewEvents`) is independently `.catch`-wrapped so one failure doesn't abort the rest; timer armed exactly once (AGG-M12). CLEAN.
- **`view-retention.ts`**: `resolveRetentionMs` (`:39-47`) correctly maps negative/non-finite/zero retention → DEFAULT (never a future cutoff that would wipe the tables); chunked DELETE with `MAX_BATCHES_PER_TABLE` iteration cap (`:70-79`); range scan on the `(…, viewed_at)` composite index. CLEAN.
- **`og-photo-fetch.ts`**: bounded `AbortSignal.timeout(10s)`, Content-Length pre-check AND post-buffer length check against `OG_PHOTO_MAX_BYTES`, fail-safe `null` on any miss so the caller falls through sizes then to the site-default OG. CLEAN.

---

## Do-not-re-file confirmations (re-verified UNCHANGED this cycle)

- **MED-R7C2-01** (histogram clip %) — REFUTED prior; not re-litigated.
- **REJ-R7C3-01** (`gps-exif-strip.ts:466` indexSize) — DISPROVED prior; the binary-parser agent independently confirmed iloc size fields validated to {0,4,8} with bounds checks. Not re-litigated.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED; not re-litigated.
- **ARCH-R7C2-01 + TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted); not re-opened.
- **TRACER "color_pipeline_decision on public download object"** — REFUTED (`isP3Pipeline` null-safe); not re-filed.
- **"process-image.ts paid on wide-gamut path" comment** — NOT stale ("paid" = idiom for expensive); not touched.
- Carried LOW/INFO deferrals (DEF-C11-01, R7C1-CR-01..04, TE-R7C2-03/04/05, OBS-R7C2-02..07, INFO-R7C2-08/09) — no new evidence, no exit criterion met; carried unchanged. (Note: TE-R7C2-04 logAuditEvent metadata-truncation is a TEST gap, not a code bug — the truncation code at `audit.ts:24-39` is UTF-16-surrogate-safe and correct.)

---

## Items deliberately NOT filed (with reasons)

- **`auth-rate-limit.ts:132` doc-comment placement** — the `/** Prune … hard cap … */` comment sits above the `PASSWORD_CHANGE_MAX_ATTEMPTS` const rather than the `prunePasswordChangeRateLimit` function it describes. Pure cosmetic; zero behavioral impact; not worth a commit at convergence (counting it would be manufactured padding).
- **CLIP `deterministicEmbedding` non-normalized vectors** — documented stub-mode behavior (CLAUDE.md: "Stub mode uses non-meaningful deterministic (non-normalized) vectors"); `cosineSimilarity` (`clip-embeddings.ts:37`) guards `denom === 0 → 0`, so no div-by-zero even on a degenerate stub vector. Intended, not a defect.

---

**Bottom line:** Run-7/run-8 convergence holds at byte-identical code. A fresh whole-repo deep sweep across 8 slices (every lib, action, route, and the 13 largest components), plus personal re-derivation of all 4 candidate findings, surfaced **zero new actionable findings**. Every candidate refuted from source. Gates green (typecheck exit 0; 35/35 focused tests). APPROVE.
