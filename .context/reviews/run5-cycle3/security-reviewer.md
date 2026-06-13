# Security Review — Run-5 Cycle-3 (security-reviewer lane)

**Repo:** GalleryKit (Next.js 16 / React 19 / Drizzle / MySQL) — `apps/web`
**Date:** 2026-06-12
**Diff under extra scrutiny:** `aa5266b5..HEAD` (21 run-5 cycle-2 commits)
**Trust model (per CLAUDE.md, authoritative):** single trust level, multiple **root** admins; no role/capability separation. Any admin can upload, edit, export/restore DB, change settings, manage admins. Findings are scored against THIS model — admin→admin "privilege" issues are out of scope; admin-controlled-input that violates a *documented* invariant or reaches *end-user* surfaces is in scope.

**Risk verdict: LOW.** Zero CRIT/HIGH. One previously-unreported LOW (Unicode-formatting bypass on the EXIF→caption→title path). Everything else either is sound, or maps 1:1 to an already-planned suppression item (plan-315/316/317/322). The cycle-2 security commits (24f607de session shape-assert + derived privacy guard; fc4abdcd checkout idempotency; 5700f184 semantic honesty) are correctly implemented and introduce no regression.

---

## Severity counts
- CRIT: 0
- HIGH: 0
- MED: 0
- LOW: 1 new (SEC-R5C3-01) + 1 informational/hardening (SEC-R5C3-02)
- Suppressed / already-planned (cross-referenced, NOT re-reported): SEC-R5C1-01 (OG Host-steering), SEC-R5C1-02 (PAT failure audit), SEC-R5C1-04 (seo-og-url hardening), SEC-R5C2-02 / AGG-R5C2-31 (OG 302 emit-time scheme assert)

---

## NEW FINDINGS

### SEC-R5C3-01 — EXIF-derived caption bypasses the Unicode bidi/zero-width sanitizer on both the render and persist paths
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed
- **Class:** Input validation / Trojan-Source visual spoofing (A03 adjacent; documented-invariant deviation)
- **Locations:**
  - `apps/web/src/lib/process-image.ts:565-574` (`cleanMetadataString`) — EXIF sanitizer that does NOT strip `UNICODE_FORMAT_CHARS`
  - `apps/web/src/lib/process-image.ts:1382` — `camera_model: cleanString(imageParams.Model)`
  - `apps/web/src/lib/image-queue.ts:385-392` — caption stub written to `alt_text_suggested`
  - `apps/web/src/lib/photo-title.ts:107-118` (`getConcisePhotoAltText`) — RENDER path: returns `alt_text_suggested` (prefix-stripped only) into `alt` / `<title>` / OG meta
  - `apps/web/src/app/actions/images.ts:979-984` (`bulkUpdateImages` applyAltSuggested) — PERSIST path: copies `caption` into `images.title` / `images.description` via raw `tx.update()` **without** `sanitizeAdminString`
- **Evidence / root cause:** `sanitizeAdminString` (`lib/sanitize.ts:161`) rejects/strips `UNICODE_FORMAT_CHARS` (`lib/validation.ts:58`: U+202A-202E, U+2066-2069 bidi; U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB zero-width). Every NORMAL admin string write (`updateImageMetadata:814`, and the `titlePrefix`/`description` fields of `bulkUpdateImages:911/920`) routes through it, and the LR PAT upload (`api/admin/lr/upload/route.ts:101/108`) does too. But `cleanMetadataString` only does `.replace(/\0/g,'').trim()` + UTF-8 byte clamp — it lets bidi/zero-width chars survive in `camera_model`, which the caption stub embeds verbatim (`generateCaptionStub`: `[AUTO] Photo taken with ${camera_model}`). That value then (a) renders into alt/title/OG text via `getConcisePhotoAltText` and (b) can be copied into a STORED `title`/`description` via the `applyAltSuggested` raw update — the one admin-string write that skips the sanitizer.
- **Attack scenario:** An admin (or a contributor whose images an admin imports) crafts a photo whose EXIF `Model` tag contains a bidi-override (e.g. `U+202E`) or zero-width joiner. On upload the caption stub stores it; the gallery then renders a visually-reordered/cloaked alt+`<title>`+`og:title` for that photo, and a bulk "apply alt as title" persists the spoofed string into the title column — directly contradicting the CLAUDE.md guarantee that `image.title`/`image.description` and "photo viewer, lightbox, OG images, SEO `<title>`/`<meta>`" reject these characters at the validation layer. No XSS (React escapes HTML; `safeJsonLd` escapes `<`/U+2028/U+2029 for JSON-LD), so impact is visual-spoofing/metadata-integrity only, and the actor is inside the single trust boundary — hence LOW.
- **Why not suppressed:** plan-315 item 1 (`applyAltSuggested`/TriState guard) only validates payload SHAPE, not string content; no suppression item covers EXIF→caption sanitization. Distinct from the planned items.
- **Suggested fix (defense at the source, one line):** route EXIF strings through the format-char stripper — e.g. in `cleanMetadataString`, apply `UNICODE_FORMAT_CHARS_RE` (`.replace`, the `/g` variant) after the NUL strip, OR specifically sanitize `camera_model` before building the caption in `generateCaptionStub`. Belt-and-braces: in `bulkUpdateImages` applyAltSuggested, pass `caption` through `sanitizeAdminString` before the `tx.update()` (mirrors every other title/description write), skipping rows that reject. Add a regression fixture feeding a `U+202E`-laden model string and asserting it is stripped before storage/render.

### SEC-R5C3-02 — (informational/hardening) npm prod-dep audit: 2 moderate (postcss XSS) transitively via Next's bundled toolchain
- **Severity:** LOW (informational) · **Confidence:** High · **Status:** confirmed (not exploitable in this app)
- **Class:** A06 Vulnerable Components
- **Evidence:** `npm audit --omit=dev` → `postcss <8.5.10` GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in CSS stringify), reached only through `next > node_modules/postcss`. The advisory's `npm audit fix --force` would DOWNGRADE Next to 9.3.3 — a destructive, regression-bound change; do NOT run it.
- **Why bounded:** the vuln triggers only when *untrusted CSS* is run through PostCSS's stringifier. GalleryKit authors its own CSS (Tailwind) at build time; no user-supplied CSS is stringified at runtime. The vulnerable code is in Next's build toolchain, not a runtime request path. No exploit path in this product.
- **Suggested action:** none required now. Track Next 16.x patch releases; the transitive `postcss` floor lifts when Next bumps its bundled copy. Record in the dependency-audit log so a future audit doesn't re-discover it as novel.

---

## VERIFIED-CLEAN (audited this cycle, no action)

### Cycle-2 security commits
- **24f607de — session token shape assert (`session.ts:121-123`):** `/^[0-9a-f]{32}$/` (random) + `/^[0-9a-f]{64}$/` (signature) checks placed AFTER `timingSafeEqual` HMAC verify — correctly avoids becoming a timing oracle (forged tokens fail HMAC first). Sound defense-in-depth; rejects shapes the minter never produces.
- **24f607de — derived `_MapSensitiveKeys` (`data.ts:425`):** now `Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>` — the compile-time map privacy guard can no longer drift below the canonical sensitive-key set. Strict improvement; closes COR-R5C2-04.
- **fc4abdcd — checkout idempotency (`api/checkout/[imageId]/route.ts:179-185,208`):** unknown-IP requests now omit the Stripe idempotency key entirely (`stripeOptions` built conditionally), so distinct unknown-IP buyers can no longer receive each other's session URL. Correct fix for TRC-R5C1-16; both branches test-pinned (`checkout-route.test.ts`, `cycle6-rpf-source-contracts.test.ts`).
- **5700f184 — semantic-search honesty:** route docstring rewritten to match the actual gate (serves `'stub'`, 503 otherwise), union narrowed to `'disabled'|'stub'`, visitor disclaimer wired, `clampSemanticTopK` now rejects non-number `raw` (booleans/arrays no longer coerce to a topK). Rate-limit pre-increment correctly placed BEFORE the config read so config-probing is metered. Note: stub mode publicly serves random-ranked results by deliberate admin opt-in + disclaimer (AGG-R5C2-01, planned) — honesty posture, not a vuln.
- **fed77250 — vitest `server-only` alias:** test-scoped in `vitest.config.ts resolve.alias` → empty stub; does NOT leak into the production build, so the `import 'server-only'` guard on `caption-generator.ts` stays live in prod. Correct.

### Attack-surface sweep
- **Secrets:** no hardcoded API keys/passwords/tokens in `src` (grep over key/secret/password/token literals — only env reads, examples, test fixtures). `MYSQL_PWD` used for dump/restore (not `-p`). Clean.
- **SQL injection:** all `db.execute(sql\`…\`)` surfaces (`admin-tokens.ts`, `admin-backfill-runner.ts`, `topics.ts`, `backfill-color-pipeline.ts`) use drizzle tagged-template parameterization (renders `?` placeholders). The new cycle-2 backfill keyset (`admin-backfill-runner.ts:252-260`) interpolates only numeric `${cursor}`/`${IMAGE_PIPELINE_VERSION}` — parameterized. Raw `conn.query` sites all use `?` bind params (`admin-users.ts:243/256`, lock RELEASE calls). Clean.
- **XSS:** all 8 `dangerouslySetInnerHTML` sinks are JSON-LD via `safeJsonLd` (`safe-json-ld.ts`: escapes `<`→`<`, U+2028, U+2029) + CSP `nonce`. React escapes all alt/title attributes. Clean (except the visual-spoofing residue in SEC-R5C3-01, which is not script-injection).
- **AuthZ on routes:** both `api/admin/**` routes wrap `withAdminAuth` (lint:api-auth gate enforces). `withAdminAuth` (`api-auth.ts:49-115`) runs token-scope path first, then same-origin + `isAdmin()` for cookie path, adds no-store/nosniff defense-in-depth. Token verify (`verifyToken`/`tokenHashesEqual`) is timing-safe (`timingSafeEqual` on hex buffers, length+charset pre-checks), looks up by hash (no plaintext in queries), fails closed, expiry-enforced.
- **Rate-limit:** public mutating routes covered — checkout (`preIncrementCheckoutAttempt`), semantic (`preIncrementSemanticAttempt`, pre-config), download POST (token-gated, `@public-no-rate-limit-required` justified), webhook (Stripe-signature-gated, justified). lint:public-route-rate-limit enforces.
- **Path traversal / SSRF:** OG internal fetch (`og-photo-fetch.ts`) builds a FIXED `${origin}/uploads/jpeg/${uuid-derived-filename}` path — filename from DB UUID, not user input; no arbitrary-URL fetch. LR PAT upload disk filename comes from `saveOriginalAndGetMetadata` (server `crypto.randomUUID()`); client `fileEntry.name` only becomes the `user_filename` DB column via `getSafeUserFilename` (basename + control-strip). No traversal. (OG `origin = new URL(req.url).origin` Host-steering = SEC-R5C1-01, already planned.)
- **Session/cookie hygiene:** `admin_session` set `httpOnly`, `secure` (prod/https-derived), `sameSite:lax` (`auth.ts:232-234,405-407`). HMAC-SHA256, timingSafeEqual, 24h expiry. Clean.
- **Unicode/bidi completeness:** `sanitizeAdminString` + `requireCleanInput` cover all NORMAL admin string surfaces and the LR PAT path; CSV escape covered (csv-escape.ts). The ONE gap is the EXIF→caption→applyAltSuggested path = SEC-R5C3-01 above.

---

## Suppression cross-references (already planned — NOT re-reported)
| Observed this cycle | Already planned as | Status |
|---|---|---|
| OG `new URL(req.url).origin` Host-steering (route.tsx:114/262) | SEC-R5C1-01 / plan-315 item 2 | planned |
| PAT failed-verify: no audit/rate accounting (api-auth.ts:86) | SEC-R5C1-02 / plan-315 item 3 | planned |
| `seo-og-url.ts` relative-branch normalization | SEC-R5C1-04 / plan-316 Unit D | planned |
| OG 302 Location emit-time scheme assert (route.tsx:255) | SEC-R5C2-02 / AGG-R5C2-31 / plan-322 | deferred (covered by SEC-R5C1-04) |
| session post-HMAC shape assert | AGG-R5C2-30 — **SHIPPED 24f607de** | done |

---

## Attack-surface coverage table (nothing skipped)
| OWASP / surface | Evaluated | Verdict |
|---|---|---|
| A01 Broken Access Control | admin routes (withAdminAuth + lint), server actions (requireSameOriginAdmin + lint:action-origin), middleware guard, last-admin-delete lock | clean |
| A02 Cryptographic Failures | Argon2 hashing, HMAC-SHA256 sessions + timingSafeEqual, token hash timing-safe, SESSION_SECRET req in prod | clean |
| A03 Injection (SQL/LIKE/CSV/XSS) | drizzle params everywhere, LIKE escape, csv-escape, safeJsonLd + nonce, React autoescape | clean except SEC-R5C3-01 (visual-spoof residue) |
| A04 Insecure Design | single-trust model documented; stub semantic honesty posture | acceptable per docs |
| A05 Security Misconfiguration | nosniff global, no-store on admin/token responses, secure cookies, CSP nonce on LD | clean |
| A06 Vulnerable Components | `npm audit --omit=dev` | 2 moderate transitive (SEC-R5C3-02, not exploitable) |
| A07 Auth Failures | Argon2id, 2-bucket login rate-limit, token expiry, session shape-assert | clean |
| A08 Integrity Failures | Stripe webhook signature gate, idempotency keys, DB restore header validation + advisory lock | clean |
| A09 Logging Failures | PAT failed-verify audit gap = planned SEC-R5C1-02 | planned |
| A10 SSRF | OG internal fetch fixed-path + Host-steering=planned; no arbitrary-URL fetch | clean / planned |
| Secrets handling | grep sweep, MYSQL_PWD, no plaintext in queries | clean |
| Path traversal / symlink / upload | UUID disk names, lstat symlink reject, SAFE_SEGMENT, LR path uses server UUID | clean |
| Rate-limit coverage | all public mutating routes (lint-enforced) | clean |
| Session / cookie hygiene | httpOnly+secure+lax, HMAC, 24h | clean |
| Unicode / bidi sanitization | sanitizeAdminString on all normal+PAT writes; gap on EXIF caption | SEC-R5C3-01 |

**Bottom line:** the cycle-2 deltas are clean and the broad surface holds. The single new actionable item (SEC-R5C3-01) is a LOW-severity, single-trust-bounded deviation from a documented invariant, fixable in ~1 line at the EXIF sanitizer plus a defense-in-depth sanitize at the applyAltSuggested copy site.
