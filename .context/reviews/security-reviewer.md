# Security Review — GalleryKit (cycle 9, run-6)

**HEAD:** af9ae6c5 · **Reviewer:** security-reviewer · **Date:** 2026-06-17
**Scope:** Whole-repo deep security sweep (auth/sessions, file upload, path traversal, SSRF, injection, CSV/XSS/bidi, rate limiting, advisory locks, DB backup/restore, the same-origin guard chain, the LIVE public semantic/similar API routes, privacy field guards, secrets, PAT auth, Stripe webhook). PRIORITY on the now-landed cycle-8 fix commits (`17f6e37c`…`e5fe98f3`) and the production CLIP/semantic-search surface.
**Risk Level:** LOW (clean)

## Summary — findings by severity

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 0
- INFORMATIONAL (NOT vulnerabilities): 1 (recorded, no action required)

**Verdict: honest convergence.** No new, HEAD-verified, worth-fixing security issue exists. The codebase converged at cycle-7 (0 findings), the activation surface was re-reviewed at cycle-8 (13 latent gaps surfaced + fixed in plan-360), and this cycle finds the cycle-8 fixes correctly landed and the remaining surface byte-for-byte at the converged baseline. The CLIP feature is LIVE; its guard chain (same-origin → maintenance → content-type/size → JSON-shape → codepoint-min → Pattern-2 rate-limit → operator-gated mode → model_version-isolated scan → public-only enrichment SELECT) holds end-to-end. All HARD GUARDS were respected — no `server-only` re-added, no `disabled`-default change, no weakening of `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / revision pin / `allowRemoteModels=false` / model_version isolation. I explicitly REJECT any temptation to "tighten" by re-adding `server-only` to `clip-model.ts` (it would break the tsx backfill; client-safety is already enforced by the native-import boundary test).

---

## Attack-surface delta since cycle-8 review (1a325fa6 → af9ae6c5)

`git diff --stat 1a325fa6..HEAD` — non-test/non-doc SOURCE files only:
- `apps/web/src/app/actions/embeddings.ts` (+21/-): AGG-C8-05 — `modelVersion` hoisted above the candidate query; `notExists` now filters on `modelVersion`. **Reviewed: correct, and still UNWIRED (no UI binds it). No security consequence.**
- `apps/web/src/app/api/search/semantic/route.ts` (+11/-): AGG-C8-09 — `isProd ? dotProduct : cosineSimilarity` gate. **Reviewed: score-identical for unit vectors; stub keeps cosine; no behavior change to inputs.**
- `apps/web/src/app/api/search/similar/[id]/route.ts` (+18/-): AGG-C8-09/10 — `dotProduct` swap + lens/date enrichment parity. **Reviewed: enrichment SELECT still public-only (no GPS/PII).**
- `apps/web/src/components/search.tsx` (+20/-): AGG-C8-04 — client short-query guard → `invalidSemantic`. **Reviewed: client-side only; the server's <3-codepoint 400 is unchanged and authoritative.**
- `apps/web/src/components/similar-photos.tsx` (+5/-): a11y `aria-controls` — no security surface.
- `apps/web/src/lib/clip-paths.ts` (+20/-): AGG-C8-12 — `clipModelArtifactDir` now asserts a 2-segment model id + 40-hex (non-`main`) revision. **Reviewed: fail-loud guard on hardcoded constants; no request-reachable input; strictly defensive.**
- `apps/web/src/db/schema.ts` (+6/-): index declaration for migration 0022.
- `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql` (+9) + `_journal.json` (+7) + `migrate.js` (+4): additive composite index `(model_version, updated_at)`. **Reviewed: journal `when=1781687094232` is strictly > prior max 1781183604120 (monotonic per the migration runbook); `migrate.js` reconciles it via `ensureIndex`; CREATE INDEX is non-destructive.**
- `apps/web/messages/{en,ko}.json` (+3 each): `search.invalidSemantic` key + reworded `semanticSearchDesc`. No security surface.

Everything else in the range is `__tests__/`, `.context/`, `plan/`, or docs. The attack surface delta is small, defensive, and security-neutral.

---

## Live production-path re-review (fresh eyes, all CLEAN)

### `POST /api/search/semantic` (semantic/route.ts) — CLEAN
- **Same-origin fail-closed:** `hasTrustedSameOrigin` (line 100) → 403; `hasTrustedSameOriginWithOptions` defaults `allowMissingSource=false` (request-origin.ts:90), so a missing/mismatched Origin AND Referer is rejected.
- **Mode gate fail-closed:** server re-reads `semanticSearchMode` (line 223), 503s unless `'stub'`/`'production'` (227); config-read throw stays `'disabled'` (224). `'production'` only resolves with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (gallery-config.ts:143) — the operator opt-in, intact.
- **Rate limit Pattern 2:** `preIncrementSemanticAttempt` consumed AFTER cheap validation, BEFORE embedding (line 209); rolled back on every early-return that never reached the guarded CPU (228, 243, 258). 30/min/IP; the `unknown`-bucket stays applied (fail-safe; a fail-open semantic endpoint would be a DoS amplifier — correct).
- **Input hardening:** Content-Type prefix+param check (116-125), chunked-TE reject (129), Content-Length guard + 8 KiB post-read body cap (135-163), JSON shape (169-174), `countCodePoints<3` 400 (185), `clampSemanticTopK` rejects non-number raw + clamps [1,50] (88-91). No ReDoS (the only regex is the anchored `^[\s;]`; `countCodePoints` is spread-based).
- **No SQL injection:** the user query is embedded to a Float32Array BEFORE any DB access; the scan is a Drizzle parameterized `eq(modelVersion, …)` + `desc(updatedAt)` + `limit(5000)` (250-256). Query string never reaches SQL.
- **No PII leak:** enrichment SELECT (291-307) = id/title/description/filename_jpeg/width/height/topic/topic_label/camera_model/lens_model/capture_date — all public (already on keyword search), `processed=true` filtered. Grep of `src/app/api/search` for `latitude|longitude|filename_original|user_filename` returns EMPTY.

### `GET /api/search/similar/[id]` (similar/[id]/route.ts) — CLEAN
- Same-origin (62) + maintenance (67) + positive-int id (75) + Pattern-2 rate-limit shared with semantic (83, rolled back 102/122/129/134/149) + **production-only** gate (101) + target-embedding lookup with `model_version` filter (112-119) → 404 on absent/corrupt (121-131). Scan is the same bounded parameterized query; self excluded (159).
- **Not an IDOR:** `id` is the auto-increment image PK; an embedding exists only for processed images; returned fields are public (enrichment SELECT 191-207, no private field). "Similar public photos for any public photo id" is the intended product behavior.

### Upload-hook embed + backfill action — CLEAN
- `embeddings.ts` (`backfillClipEmbeddings`) is fully gated: `isAdmin()` + `requireSameOriginAdmin()` + per-admin hourly rate-limit (50-59), disabled→no-op (80), production→real encoder + `PRODUCTION_MODEL_VERSION`. `resolveOriginalUploadPath(filenameOriginal)` where `filename_original` is a server-generated `randomUUID()` derivative — no user-controlled path to `sharp()`. Buffer stored via mysql2 verbatim — no injection. **Still UNWIRED; sidecar is canonical.**
- `clip-model.ts` `embedImageReal` resizes via Sharp with `autoOrient`/`toColourspace('srgb')`/`removeAlpha` (channel-count asserted) — no path or decode surface from request input.

---

## Cross-cutting verifications (all PASS at HEAD)

| Area | Verification |
|---|---|
| **Auth/sessions** | `session.ts`: HMAC-SHA256 verified FIRST, `timingSafeEqual`, shape checks AFTER crypto (no timing oracle), 24 h age window, prod refuses DB-secret fallback. `proxy.ts` cookie-presence guard on `/[locale]/admin/*` (full crypto in server actions, defense-in-depth). |
| **SQL injection** | All raw-SQL sites are Drizzle tagged-template `sql\`…${param}\`` (admin-tokens.ts, topics.ts, admin-backfill-runner.ts, health) or `conn.query(…, [params])` placeholders (admin-users.ts, advisory-lock releases). No string concatenation of untrusted input. |
| **Command injection** | `db-actions.ts` is the only `child_process` user: `spawn('mysqldump'/'mysql', [fixed-args, DB_NAME])` with credentials in `MYSQL_PWD` env (not `/proc/cmdline`), HOME excluded (no `~/.my.cnf`), `--one-database` on restore. No shell, no interpolation. |
| **XSS** | All `dangerouslySetInnerHTML` sites inject JSON-LD via `safeJsonLd` (escapes `<`→`<`, U+2028/2029) + CSP nonce. `sanitizeAdminString`/`UNICODE_FORMAT_CHARS` reject bidi/zero-width at every admin string write; `sanitizeForOg`/`stripUnicodeFormatting` scrub machine-derived EXIF on render. |
| **CSV injection** | `csv-escape.ts`: C0/C1 strip, derived bidi/zero-width strip, CRLF collapse, leading-whitespace-tolerant `^\s*[=+\-@]` formula-prefix quote, RFC-quote wrap. |
| **Path traversal / symlink** | Paid-download (`/api/download/[imageId]`): `path.resolve` + `startsWith(uploadsDir+sep)` + `lstat` symlink reject + `realpath` containment + open-before-claim. Upload routes: `SAFE_SEGMENT` + whitelist + `randomUUID` filenames. CLIP path math uses hardcoded constants + operator env only. |
| **SSRF** | Runtime `env.allowRemoteModels=false` (clip-model.ts:88); grep confirms NO `allowRemoteModels=true` anywhere. Only outbound fetch is the operator-run download script (HTTPS, pinned revision). OG origin-pinning defense unchanged. |
| **Privacy field guard** | `publicSelectFields` derived from `adminSelectFields` by omitting latitude/longitude/filename_original/user_filename/original_format/original_file_size; `_PrivacySensitiveKeys` compile-time guard + symmetric `privacy-fields.test.ts` SENSITIVE_KEYS (incl. uploaded_by). Live search paths reference zero PII columns (grep-verified). |
| **PAT auth (admin-tokens)** | `gk_`+43-char shape gate before DB; SHA-256 stored only; `timingSafeEqual`; `expires_at` enforced; scope set authorizes; `verifyToken`/`list`/`revoke` fail-closed; revoke scoped by `user_id` (no IDOR); plaintext never reaches a query param. |
| **Stripe webhook** | Mandatory `constructStripeEvent` signature verify before any DB work; `payment_status==='paid'` gate; tier allowlist; zero-amount reject; `sessionId`-UNIQUE idempotency + dup-key-loser disambiguation; PII never logged at error level; deleted-image FK → 200 (no retry storm). |
| **Rate-limit lint gates** | `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` ALL exit 0 at HEAD. |
| **Secrets** | Source/script secret scan EMPTY; no `hf_`/`HF_TOKEN`/hardcoded keys; `.env*.example` carry placeholders only; CLIP model download is anonymous (public model). |
| **Dependency audit** | `npm audit --omit=dev --audit-level=high`: 0 HIGH/CRITICAL. 2 MODERATE (postcss `<8.5.10` CSS-stringify XSS, transitive under Next) — build-time only, no runtime user-content path, same item closed in cycle-7. |
| **Error-path info leak** | All route catch blocks return generic `{error}` JSON with `NO_STORE` headers; detail to server logs only. Localized generic messages across action boundaries (no raw SQL/driver internals to client). |

---

## Informational note (NOT a vulnerability — recorded for completeness)

`embeddings.ts` `backfillClipEmbeddings` remains **UNWIRED** — no UI calls it; the canonical entry point is the sidecar `scripts/backfill-clip-embeddings.ts` (documented at embeddings.ts:70-73, 89-91). The cycle-8 AGG-C8-05 fix (model_version-aware `notExists`) is correct and now matches the sidecar's per-version selection, but because the action is unreachable from any request today, it carries no live security or correctness consequence. Flagged only so a future wiring effort knows the selection is already model_version-scoped. No action required.

## Security Checklist
- [x] No hardcoded secrets (source + scripts + env examples clean; git-history pattern scan clean)
- [x] All inputs validated (Content-Type/Length/body caps, codepoint length, topK clamp, JSON shape, slug/filename/email shape)
- [x] Injection prevention verified (Drizzle params everywhere; query embedded before SQL; no exec/eval/Function; spawn with fixed argv)
- [x] Authentication/authorization verified (sessions HMAC+timing-safe; admin actions isAdmin+same-origin; PAT scoped+constant-time; semantic/similar intentionally public+same-origin; production mode operator-gated, fail-closed)
- [x] SSRF — runtime allowRemoteModels=false; no request-reachable outbound host
- [x] Path traversal / symlink — resolve+startsWith+lstat+realpath on download; UUID filenames on upload; CLIP path uses constants+env
- [x] XSS — JSON-LD via safeJsonLd + nonce; bidi/zero-width rejected/stripped on all rendered strings
- [x] CSV formula injection — escapeCsvField full hygiene pass
- [x] Privacy — publicSelectFields omits PII (compile-time + test guard); live search SELECTs public-only (grep-verified)
- [x] Rate limits on public surfaces (Pattern 2, fail-safe on unknown IP); three lint gates green
- [x] Dependencies audited (0 HIGH/CRITICAL; 2 build-time MODERATE noted)
- [x] Migration 0022 additive + monotonic journal + reconciled in migrate.js
- [x] HARD GUARDS respected (server-only NOT re-added; disabled default intact; prod-gate/revision-pin/offline/model_version isolation untouched)
