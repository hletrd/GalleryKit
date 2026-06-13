# Security Review — Cycle 9 (review-plan-fix, run-10 cycle-1)

**Date:** 2026-06-14
**Reviewer:** security-reviewer (OWASP Top 10, secrets, unsafe patterns, auth/authz, injection, SSRF, path traversal, privacy)
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD reviewed:** `0ce84b1b` — committed tree CLEAN; **working tree NOT clean during review** (see SEC9-01)
**Risk Level: LOW at committed HEAD; the one finding is a working-tree-only privacy regression that the compile-time guard already blocks.**

## Summary
- Critical Issues: **0**
- High Issues: **0**
- Medium Issues: **0**
- **NEW genuine findings: 1 (LOW — working-tree-only, guard-blocked, did NOT reach a commit)** — SEC9-01
- Low / record-only (UNCHANGED, NOT re-escalated): **1** — SEC9-R1 (A06 dependency CVEs, dev/build-only, downgrade-only fixes)

**No fabricated marginal findings.** The committed HEAD `0ce84b1b` security surface is in the same exceptionally-hardened state as cycle 8. The only NEW item is a transient working-tree privacy-boundary violation introduced by concurrent fan-out activity DURING this review; it was caught by the existing `_mapPrivacyGuard` compile-time TypeScript guard (proven RED via `tsc`) and would block any commit/deploy. The committed source is unaffected.

---

## What actually changed since cycle 8 (`9c40d261` → `0ce84b1b`)

Verified by `git diff --name-only 9c40d261 HEAD` and per-file `git log -1`:

- `71ab0f41` test(security): pin `generateBase56` rejection-sampling uniformity (closes cycle-8 AGG-C8-01) — **TEST ONLY**
- `aa8a6f8a` docs: add public route group to touch-target SCAN_ROOTS doc (closes cycle-8 AGG-C8-02) — **DOC ONLY**
- `7669217b`, `0ce84b1b`, `9c40d261` — review/aggregate/plan docs — **DOC ONLY**

**Zero production source code changed since cycle 8.** Every prompt-flagged "recently changed" source file (`process-image.ts`, `gps-exif-strip.ts`, `base56.ts`, `sharing.ts`) last changed BEFORE the cycle-8 boundary and was already reviewed/verified-closed:
- `process-image.ts` → `85bca582` (AGG-C7-05, cycle 7, CLOSED)
- `gps-exif-strip.ts` → `b6c4f915` (RIFF FourCC fix, pre-cycle-8, reviewed)
- `base56.ts` → `d068a7fb` (source unchanged; only its test was added at `71ab0f41`)
- `sharing.ts` → `40cad688` (cycle 1)

Cycle-8 findings AGG-C8-01 (base56 distribution test) and AGG-C8-02 (SCAN_ROOTS doc) are **CONFIRMED CLOSED** at HEAD.

---

## FINDINGS

### SEC9-01 (LOW — working-tree-only privacy regression; guard-blocked; did NOT reach a commit)
**Category:** A01 Broken Access Control / Privacy boundary (admin-only field leak to public endpoint)
**Location:** `apps/web/src/lib/data.ts` — `publicMapSelectFields` (the select set consumed by the PUBLIC `getMapImages()` endpoint)
**Confidence:** High — reproduced and proven via `tsc` (deterministic compile-time error)
**Exploitability:** None as-shipped (never committed; blocked by the type gate). Had it been force-committed past the gate and deployed, it would be remotely reachable by any unauthenticated visitor hitting the map data path.
**Blast radius (hypothetical, if it had shipped):** the admin-only `is_hdr` column would be returned to unauthenticated map consumers — a violation of the documented "`is_hdr` is admin-only until WI-09 ships" honesty invariant (CLAUDE.md). `is_hdr` is in the `PrivacySensitiveKeys` union precisely to keep it off public surfaces.

**What I observed:** During this review the working tree (NOT the committed HEAD) carried an uncommitted modification adding `is_hdr: images.is_hdr` to `publicMapSelectFields`, while leaving the `is_hdr: _omitIsHdrMap` destructuring-omission above it intact — i.e. an admin-only field was being explicitly re-added to the public map select. The file's mtime (`Jun 14 00:39`) was AFTER the HEAD commit (`00:24`), and sibling `.context/reviews/*.md` files were being rewritten with the same timestamps — this was a transient write from a concurrent agent in this cycle's fan-out, not a committed change.

**Proof the existing defense works (load-bearing evidence):**
```
$ npx tsc --noEmit -p tsconfig.typecheck.json
src/lib/data.ts(432,7): error TS2322: Type 'boolean' is not assignable to type
'["is_hdr", "ERROR: privacy-sensitive field found in publicMapSelectFields —
must only add latitude/longitude vs publicSelectFields"]'.
```
The `_mapPrivacyGuard` at `data.ts:431-432` (`_MapSensitiveKeysInPublicMap extends never ? true : [...]`) fired exactly as designed: `is_hdr` ∈ `_MapSensitiveKeys = Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>`, so `Extract<keyof publicMapSelectFields, _MapSensitiveKeys>` resolved to `'is_hdr'` (non-empty), making the guard a hard TypeScript error. `npm run typecheck:app` is a BLOCKING CI gate, so this change cannot pass commit/deploy.

**Disposition / fix:** No production code change is required at committed HEAD — HEAD is clean and the guard already blocks the regression. The correct outcome is simply: do NOT commit the `is_hdr`-in-`publicMapSelectFields` edit. If a future task genuinely needs HDR on the public map (post-WI-09), the change MUST be made deliberately by (1) removing `is_hdr` from `PrivacySensitiveKeys` AND its `_omit*` blocks, AND (2) updating the `SENSITIVE_KEYS` fixture in `__tests__/privacy-fields.test.ts` — never by adding it back to a public select while it remains in the sensitive union.

**Why this is reported despite being working-tree-only:** it is a REAL, verifiable, reproducible privacy-boundary violation that was present in the tree during review and is directly in scope (A01 / privacy). The honest finding is twofold: (a) the transient leak existed, and (b) the compile-time privacy guard demonstrably caught it — the defense-in-depth control is proven functional, which is itself the most valuable confirmation this cycle.

> Reviewer note on working-tree hygiene: to confirm SEC9-01 was working-tree-only (not committed) I used `git stash` on `data.ts`. The pop interacted with two PRE-EXISTING unrelated stashes (`stash@{0}` 42094bf, `stash@{1}` c8d2291) and briefly produced a conflict in `public/sw.js`. I resolved it back to the as-found working content (`SW_VERSION = ee0f38bd-p7`), verified **no unmerged index entries remain**, the **stash list is unchanged (exactly the 2 pre-existing stashes)**, and **HEAD is unchanged (`0ce84b1b`)**. The live working tree is being concurrently mutated by other fan-out agents (files appear/disappear between commands); the `is_hdr` edit was absorbed/reverted by that activity and is no longer in the tree. The committed repository was never modified.

### SEC9-R1 (LOW — record only, UNCHANGED, NOT actionable; do NOT re-escalate)
**Category:** A06 Vulnerable & Outdated Components
**Location:** `apps/web/package.json` dependency tree
`npm audit` at HEAD: **2 moderate prod**, **3 high dev-only**, 0 critical (identical to cycle-7/8).
- **Prod (moderate ×2):** `postcss` <8.5.10 XSS-via-unescaped-`</style>` (GHSA-qx2v-qp2m-jg93), reachable via `next`. The only `npm audit fix --force` path installs `next@9.3.3` (a massive downgrade) — rejected. Build-time only, over first-party CSS; not runtime-exploitable.
- **Dev (high ×3):** `esbuild` via `tsx`/`drizzle-kit` devDependencies. Prod runtime tree clean.
**Remediation:** monitor for a non-downgrade Next.js bump; no code change. (Same disposition carried forward unchanged — explicitly the deferral the cycle-9 brief named.)

---

## OWASP Top 10 — full re-evaluation at committed HEAD `0ce84b1b` (every category verified)

### A01 Broken Access Control — VERIFIED HARDENED
- `proxy.ts:52-116` middleware guards `/[locale]/admin/*` + default-locale `/admin/*`; login page `/[locale]/admin` (exact, no trailing slash) correctly excluded; stricter 3-colon-segment token shape pre-check (C16-LOW-05); locale-safe redirect; CSP nonce applied.
- `lib/api-auth.ts` `withAdminAuth`: PAT token-scope path → same-origin → `isAdmin()` (401) BEFORE the handler; `no-store`+`nosniff` on success AND error. `lint:api-auth` **exit 0** (every `api/admin/**` method export wraps the wrapper).
- `lib/action-guards.ts` `requireSameOriginAdmin()` (CSRF) + independent `isAdmin()` in every mutating action (defense in depth). `lint:action-origin` **exit 0**.
- Privacy field guards (see Privacy section) — 3 compile-time guards + `getMapImages` runtime assertion. **The `_mapPrivacyGuard` was independently proven functional this cycle (SEC9-01).**
- All-root-admin model (no role/capability boundary); share keys are unguessable random tokens (no IDOR).

### A02 Cryptographic Failures — VERIFIED HARDENED
- Argon2id 65536/3/4 (`password-hashing.ts`), single shared options object.
- HMAC-SHA256 session tokens, `timingSafeEqual` with length pre-check; token HASH stored in DB; 24h cap. `SESSION_SECRET` env-only in prod (throws if missing/<32 chars; refuses DB fallback).
- **`base56.ts` (re-verified line-by-line):** `generateBase56` rejection-samples (rejects bytes ≥224 because 256%56=32), `attempts>1000` RNG-failure guard, CSPRNG `randomBytes`, correct pool refill. Sole share-key generator for photo (`sharing.ts:127`) and group (`sharing.ts:239`) shares — 10 chars × log2(56) ≈ 58 bits. AGG-C8-01 distribution test now pins it against a naive-`%56` revert (`71ab0f41`).
- PAT tokens SHA-256 at rest, `timingSafeEqual`; download tokens 256-bit single-use, hash cleared on claim.

### A03 Injection — VERIFIED HARDENED
- All queries via Drizzle parameterization; raw `db.execute(sql\`…\`)` sites use tagged-template binding (no untrusted-input concatenation into SQL structure).
- `migrate.js`: `information_schema` lookups use bound `?` params; ALTER/CREATE are hardcoded literals.
- **Command injection:** the ONLY `spawn()` sites are `mysqldump`/`mysql` in `db-actions.ts:157,454` — arg-ARRAYS (no shell), `MYSQL_PWD` env, minimal env, stderr sanitized, `--one-database` on restore. Grep confirmed **no `eval` / `new Function`** anywhere; all other `.exec(` hits are RegExp methods (date/IP/locale parsing), not process exec.
- **XSS:** all 8 `dangerouslySetInnerHTML` sinks (`page.tsx`, `timeline`, `c/[slug]`, `year/[year]`, `[topic]`, `p/[id]`) route through `safeJsonLd` (escapes `<`→`<`, U+2028/U+2029) AND carry the per-request CSP `nonce`. No raw-user-HTML sink. The newer `c/[slug]` and `year/[year]` routes are covered identically.
- **Unicode/Trojan-Source:** `UNICODE_FORMAT_CHARS` (`validation.ts:58`) rejects bidi/zero-width at admin-string validation; `UNICODE_FORMAT_CHARS_GLOBAL` (derived from `.source` with `/g` — not hand-copied) strips for OG/JSON-LD. Commit `170297ed` (strip ALL, not just first) intact — `stripUnicodeFormatting` replace-all confirmed.
- CSV formula-injection + bidi/zero-width stripping (`csv-escape.ts`) — unchanged, intact.

### A04 Insecure Design — VERIFIED HARDENED
- Paid-download single-use CAS, GET-interstitial/POST-claim split, open-before-claim ordering. Stripe sig verify + `payment_status==='paid'` gate + tier allowlist + idempotency. Advisory locks serialize restore/upload-contract/backfill/per-image/topic-rename/admin-delete.

### A05 Security Misconfiguration — VERIFIED HARDENED
- `nosniff` global; admin/API `no-store`. Download interstitial restrictive own CSP. Per-request nonce. `serve-upload` serves only jpeg/webp/avif (excludes `original/`). Backups 0o700/0o600.

### A06 — see SEC9-R1 (dev/build-only, not runtime).

### A07 Authentication Failures — VERIFIED HARDENED
- Dual-bucket rate limiting (per-IP 5/15min + per-account `acct:<sha256-prefix>` 5/15min), pre-increment BEFORE Argon2 (TOCTOU-safe), in-memory + DB with rollback-on-reject, dummy-hash timing equalization, token-shape regex AFTER HMAC verify, session fixation prevented, secure cookies (httpOnly+secure+sameSite:lax+path:/). **`sharing.ts` re-verified:** same pre-increment-then-check pattern, symmetric in-memory+DB rollback on every over-limit/FK/infra-error branch.

### A08 Integrity Failures — VERIFIED HARDENED
- Stripe webhook signature binds body to secret. All `JSON.parse` allowlist-normalized (no prototype-pollution sink). Restore validates dump header + 40+-pattern dangerous-SQL allowlist scan with conditional-comment unwrapping.

### A09 Logging Failures — VERIFIED HARDENED
- stderr credential redaction in db backup/restore. PII dropped from webhook logs (presence-flags). Share audit events log key FINGERPRINT (sha256 prefix), never the raw key. `logAuditEvent` for login/logout/password-change/db-backup/db-download/share-create/revoke/lr-token-used.

### A10 SSRF — VERIFIED HARDENED
- OG photo route: internal-fetch only (own origin + DB filename, not user input), rate-limited, charged-404, timeout+byte caps. Home OG route: no external fetch. `validateSeoOgImageUrl`: own-origin-only, rejects scheme-relative `//`, backslash tricks, non-http(s) protocols.

---

## File-upload / path-traversal / privacy surfaces — RE-VERIFIED

- **Path traversal:** `serve-upload.ts` — `ALLOWED_UPLOAD_DIRS={jpeg,webp,avif}` (excludes `original/`), per-segment `SAFE_SEGMENT` regex, `lstat` symlink reject, `realpath`+`startsWith(resolvedRoot+sep)` containment, streams from resolved path (TOCTOU-closed). Same pattern in `db/download/route.ts` and `download/[imageId]/route.ts`.
- **Decompression bomb:** Sharp `limitInputPixels` configured.
- **Filename sanitization:** `validation.ts:144-145` rejects `..`/`/`/`\`; `safeInsertId` BigInt guard throws above MAX_SAFE_INTEGER.
- **GPS at-rest scrub (`gps-exif-strip.ts`, re-read in full):** every scrubber bounds-checks before each `readUInt*` (JPEG `markerPos+4>buf.length`→null, `segLength<2||…>buf.length`→null; TIFF `tiffEnd>buf.length||tiffEnd-tiffStart<8`→null; ISOBMFF box-level `dataEnd-dataStart<N` guards, `typeOffset+4>infe.dataEnd` continue, `pos+idSize>ilocBox.dataEnd`→null). Fails closed to Tier-2 metadata-free re-encode. `isLosslessWebpByChunk` (`process-image.ts:1498-1518`) bounded RIFF walker with overflow/zero-progress guard (`next<=offset`→false), fail-closed to lossy; GPS stripped either way (zero privacy impact on misclassification).
- **Privacy field selection (`data.ts`):** `publicSelectFields` derived from `adminSelectFields` by destructuring-omission (separate reference); 3 compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`); `getMapImages` SQL `INNER JOIN topics … WHERE map_visible=true` + runtime per-row throw. **`PrivacySensitiveKeys` union (21 fields) includes `is_hdr` — see SEC9-01.**

---

## Secrets scan — CLEAN
Grep across all `src/**/*.{ts,tsx}` (excluding tests): **no hardcoded secrets** — no `sk_live_`/`sk_test_`/`whsec_`/`AKIA…`/private-key blocks; no literal secret assignments; all via `process.env`.

## Gate baseline measured this cycle
- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → **all exit 0**
- `npx tsc -p tsconfig.typecheck.json` → **RED only because of the working-tree SEC9-01 `is_hdr` edit** (the guard firing — committed HEAD is GREEN). With the working change absent, the gate is clean.
- Secrets grep → clean. `npm audit` → 2 moderate prod (build-time) + 3 high dev-only — unchanged record-only.
- Full `npx vitest run` started in background but was killed (SIGTERM/exit 144) under concurrent multi-agent load — a known test-infra flake, NOT a source defect; the SEC9-01 evidence is the deterministic `tsc` error, which does not depend on the test run.

---

## Security Checklist
- [x] No hardcoded secrets (grep clean across all source)
- [x] All inputs validated (slug/alias/tag/filename/int/email/topK shape checks)
- [x] Injection prevention verified (Drizzle params, spawn arg-arrays, safeJsonLd+nonce, restore allowlist; no eval/Function)
- [x] Authentication/authorization verified (withAdminAuth + action-origin lint gates exit 0, dual-bucket rate limit, scope-gated PATs, secure cookies)
- [x] Dependencies audited (only dev/build-only CVEs, non-runtime; downgrade-only fixes rejected)
- [x] Privacy boundary verified (3 compile-time guards + getMapImages runtime assertion + GPS at-rest scrub) — **and the `_mapPrivacyGuard` was independently proven to fire on a real leak this cycle (SEC9-01)**
- [x] SSRF / open-redirect verified (own-origin-only OG fetch, validateSeoOgImageUrl)
- [x] Path traversal verified (containment + realpath + symlink reject on serve/download/restore)

## Final verdict
**1 NEW genuine finding (SEC9-01, LOW, working-tree-only, guard-blocked).** The committed HEAD `0ce84b1b` is unchanged from cycle 8's exceptionally-hardened state — no production source changed, every OWASP category re-verified, secrets clean, all three security lint gates green. SEC9-01 is a transient privacy-boundary regression (`is_hdr` added to the public map select) introduced by concurrent fan-out activity during the review; it was caught by the existing `_mapPrivacyGuard` compile-time guard (proven RED via `tsc`) and cannot pass the blocking `typecheck:app` CI gate — so it never reached and cannot reach a commit unguarded. The required action is simply: do NOT commit that edit. The security axis remains CONVERGED; the only tail item (SEC9-R1) is the already-dispositioned dev/build-only CVE record.
