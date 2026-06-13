# Security Review — Cycle 6 — Fresh Adversarial OWASP Top 10 Pass

**Date:** 2026-06-13
**HEAD:** `4c3d5924` (working tree CLEAN)
**Reviewer:** security-reviewer (read-only role — Write is blocked; the orchestrator persists this verbatim delivered report, as last cycle).

**NEW exploitable findings: 0.** Full OWASP Top 10 re-verified clean at HEAD; the delta since base `1dde9b1e` has zero security surface; every documented CLAUDE.md security claim matches current code.

**Scope:** Full OWASP Top 10 + repo specifics across `apps/web` — auth/session/crypto, all `api/admin/**` + public API routes, all server actions, Stripe webhook + checkout + download, OG/SSRF, XSS (JSON-LD + OG), injection (Drizzle + raw SQL + mysqldump/restore + smart-collections + CSV), path traversal, secrets.

**Risk Level: LOW** (no live-exploitable vulnerability; convergence holds).

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0 new
- Doc/code security-claim mismatches: 0

## Delta verification (base `1dde9b1e` → HEAD `4c3d5924`, 7 commits)

The actual source changes carry **no security surface**:
- `apps/web/scripts/backfill-color-pipeline.ts` — pure refactor extracting `cleanupDeletedMidReencodeVariants` + `collectDeletedMidReencodeFiles` to module-level exports for testability. Same `[]`-dir-scan cleanup contract, same post-commit timing, same `affectedRows===0` partition logic; no behavior change. Verified line-by-line against the diff.
- Three public `<Link>` className additions (`(public)/timeline/page.tsx:154`, `components/home-client.tsx:434`, `components/topic-empty-state.tsx:18`) — `inline-flex items-center min-h-11 px-2` a11y tap-target only. `href` values unchanged, all internal (`localizePath`/`clearHref`), no user-controlled URL.
- Remaining changes are `*.test.ts` files + `.context/reviews/**` + `plan/**` docs.

Note: the `M`-marked files in the initial git-status snapshot (`sw.js`, `(public)/page.tsx`, `admin/(protected)/error.tsx`, `admin-backfill-runner.ts`) have **no diff** vs base — they were committed this cycle and their current content is identical to the prior verified-clean state.

## OWASP Top 10 — re-verified at current line numbers

- **A01 Access Control** — `proxy.ts` middleware guards every `/[locale]/admin/*` sub-route (token presence + 100-char + 3-segment format, full crypto in actions); central `withAdminAuth` (`lib/api-auth.ts:49`) enforces `hasTrustedSameOrigin` CSRF + `isAdmin()` on every admin API route, adds no-store/nosniff; `requireSameOriginAdmin()` on every mutating server action (lint gate green); PAT path (`admin-tokens.ts`) is user-scoped — `revokeToken` keys on `id AND user_id` (no cross-user IDOR); download/checkout authz is the single-use token / Stripe signature, not a guessable id.
- **A02 Crypto** — Argon2id (doc params 65536/3/4), HMAC-SHA256 sessions verified with `timingSafeEqual` + length-prefix guard, shape-regex AFTER crypto (no timing oracle), `SESSION_SECRET` env-only in prod (throws on DB fallback), session-token hashed at rest, PAT hashed (SHA-256) at rest with constant-time compare.
- **A03 Injection** — zero `sql.raw`; all `sql\`...\`` use Drizzle `${}` parameter binds; smart-collections column allowlist + `isScalarValue` + LIKE-escape + IN-cap; CSV/Unicode strip (`validation.ts` `UNICODE_FORMAT_CHARS`); `mysqldump`/`mysql` via `spawn` argv arrays + `MYSQL_PWD` env (no shell, no `/proc/cmdline` leak, no `HOME` → no `.my.cnf` injection).
- **A04 Insecure Design** — `serve-upload.ts` + download route: `ALLOWED_UPLOAD_DIRS` whitelist, per-segment `SAFE_SEGMENT` regex, `.`/`..` reject, `lstat` symlink reject, `realpath` + `startsWith(root+sep)` TOCTOU containment, dir↔ext map, no SVG; download opens file BEFORE atomic single-use claim (no token burn on missing file). **The new WebP GPS-strip bug (DBG-C6-01) is NOT a privacy regression — the `null` fallback re-encode still strips GPS; it is a quality/correctness defect, not a security/privacy leak.**
- **A05 Misconfig** — `next.config.ts` ships `nosniff` / `X-Frame-Options: SAMEORIGIN` / `Referrer-Policy` / `Permissions-Policy` / HSTS (prod); cookies `httpOnly` + `secure` (trusted-HTTPS gated) + `sameSite: lax`; nonce-based CSP in `proxy.ts`.
- **A07 Auth Failures** — login rate-limit pre-increment BEFORE Argon2 (TOCTOU), dual IP + account buckets, dummy-hash for timing-safe enumeration defense, session-fixation prevented via insert-then-delete-others transaction.
- **A08 Integrity** — Stripe webhook: signature mandatory-first (400 in constant time on miss), `payment_status==='paid'` gate, tier allowlist, idempotency via SELECT + `insertId>0` dup-key-loser disambiguation, zero-amount reject, deleted-image fails-closed 200.
- **A10 SSRF** — OG photo fetch uses `new URL(req.url).origin` (own-origin only), fixed `/uploads/jpeg/` path with UUID-derived `filename_jpeg`, 10s `AbortSignal.timeout` + 1 MB cap (Content-Length pre-check + post-buffer).
- **XSS** — all 8 `dangerouslySetInnerHTML` confirmed routed through `safeJsonLd` (escapes `<`→`<` + U+2028/2029); all OG text via unified `sanitizeForOg` (global bidi/zero-width strip + C0 control strip).

## Commonly-missed classes — swept, clean
- **Open redirect**: only dynamic `redirect()` (`[topic]/page.tsx:160`) targets the canonical DB slug via `localizePath`; `tags` carried as encoded `URLSearchParams` (length-capped), never path/host.
- **Prototype pollution**: smart-collections `validateNode` reads only explicit keys and rebuilds fresh objects (no spread/merge, no `__proto__` walk); `__proto__`/`constructor` keys are ignored.
- **ReDoS**: new/changed regexes (touch-target audit patterns, `UNICODE_FORMAT_CHARS`, `SAFE_SEGMENT`) are anchored character classes — no nested quantifiers.
- **Secrets**: source sweep for hardcoded key/secret/password/token literals — empty. `.env.local.example` uses `<change-me>` placeholders.
- **Insecure deserialization**: `JSON.parse` sites (smart-collections, semantic search) all validate structure/types after parse.

## Gates
- `lint:api-auth` → **OK** · `lint:action-origin` → **OK** · `lint:public-route-rate-limit` → **OK**

## Security Checklist
- [x] No hardcoded secrets (source sweep empty)
- [x] All inputs validated (slug/tag/length/integer/Unicode on every public + admin surface)
- [x] Injection prevention verified (Drizzle params, allowlists, argv-array dump, LIKE-escape)
- [x] Authentication/authorization verified (middleware + central wrapper + per-action origin + token scoping)
- [x] Dependencies audited (no change since prior cycle; `npm audit` advisories are build/dev-only with downgrade-only fixes — do NOT take)

**Conclusion:** No new exploitable vulnerability. The delta is non-security (test pins + a11y className tweaks + a testability refactor). The full OWASP surface and every documented security claim were independently re-verified against current code. The cycle's one real bug (DBG-C6-01, WebP RIFF field-order) is a quality/correctness defect with NO privacy impact — explicitly assessed and out of security scope.
