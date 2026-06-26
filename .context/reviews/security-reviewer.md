# Security Review — GalleryKit Cycle 15 (R15C15)

**HEAD:** 2f886351 · **Agent:** security-reviewer (opus) · **Risk level: LOW** (mature, heavily-hardened; no exploitable defect this cycle).

**One-line summary:** No new exploitable vulnerability; the cycle-13/14 `isAdmin` defense-in-depth sweep on the color-audit components is incomplete — two admin-only fields (`icc_profile_name`, `bit_depth`) render without the `isAdmin` gate every sibling field carries (LOW, latent — the authoritative data-layer omission still protects them).

## Summary
| Severity | Count | Notes |
|----------|-------|-------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW (new) | 1 | SEC-15-01 — un-mirrored `isAdmin` gate on `icc_profile_name` + `bit_depth` color-audit rows |
| Confirmed-deferred | 3 | SEC-14-02 (LR `err.message`), SEC-13-02 (`hasTrustedSameOriginWithOptions`), SEC-13-03 (GET rate-limit CI gate) |

---

## LOW — new this cycle

### SEC-15-01 — `isAdmin` defense-in-depth gate missing on two admin-only color-audit rows (un-mirrored cycle-13/14 sibling) — HIGH confidence, LOW severity, latent
**Files:**
- `color-details-section.tsx:233` (`const iccName = image.icc_profile_name || ''`), rendered at `:369` and `:383` guarded only by `{iccName && …}` — no `isAdmin &&`.
- `color-details-section.tsx:469` source bit-depth row: `{image.bit_depth != null && image.bit_depth > 0 && (…)}` — no `isAdmin &&`.
- `info-bottom-sheet.tsx:442` (`bit_depth` row, nullness-only).
- `lightbox-color-pip.tsx:93-100` + `color-details-section.tsx:274,281` — copy-to-clipboard snapshot folds `iccProfileName`/`sourceBitDepth`/`matrix`/`hasGainMap` ungated.

**Category:** OWASP A01 (Broken Access Control) / A04 (Insecure Design — inconsistent enforcement), adjacent.

Both fields are admin-only (`data.ts` `PrivacySensitiveKeys` includes `bit_depth` + `icc_profile_name`; omitted from `publicSelectFields`, enforced by `_SensitiveKeysInPublic`). That data-layer omission is the authoritative control and is sound, so **not exploitable today**. The cycle-13/14 work added a SECOND defense-in-depth layer: gate every admin-only color field render on `isAdmin` explicitly so a future call site passing admin-fetched data with `isAdmin={false}` cannot leak. That sweep gated `transfer_function` (:402), `color_pipeline_decision` (:408), `matrix_coefficients` (:449), `color_space` (:458), `was_downscaled` (:479), `has_gain_map` (:582), `isHdr` badge (:558) — but missed `icc_profile_name` and `bit_depth`, the two older rows.

**Latent scenario:** a future refactor rendering `<ColorDetailsSection>`/`<LightboxColorPip>` from an admin listing query in a context where `isAdmin` is independently `false` (e.g. a shared-link/embed surface) would surface the ICC profile name (custom-monitor profiles routinely embed person/date/serial strings) and source bit depth to anonymous viewers while the gated siblings stay hidden — a silent, field-specific leak. Blast radius minor (low-sensitivity workflow metadata).

**Test note:** `color-details-section-delivered.test.ts:24` currently pins the un-gated bit-depth form — the fix must update that assertion and add an `isAdmin`-gating lock for both fields.

**Fix:** `iccName = isAdmin ? (image.icc_profile_name || '') : ''`; gate the `:469`/`info-bottom-sheet.tsx:442` bit-depth rows on `isAdmin &&`; gate the clipboard snapshot keys. (2-agent agreement: critic Finding 2.)

---

## Confirmed-deferred (re-verified this cycle, no change in exposure)
- **SEC-14-02 — LR-upload raw `err.message` disclosure** (`lr/upload/route.ts` post-`saveOriginalAndGetMetadata` catch). Recipient is an authenticated admin / valid PAT holder; ENOSPC pre-empted by the `bavail` 507 pre-check. Admin-only, minimal. Optional cleanup; deferred as cycle 14.
- **SEC-13-02 — `hasTrustedSameOriginWithOptions` exported** (`request-origin.ts:109`). Zero production callers; test-locked. Deferred.
- **SEC-13-03 — expensive public GET routes** (OG x2, semantic similar) rate-limited at runtime (charged-404) but `lint:public-route-rate-limit` scans only POST/PUT/PATCH/DELETE. Runtime posture correct; CI guard narrower. Deferred.

## Surfaces audited and sound (no findings)
Argon2id (m=64 MiB,t=3,p=4) + dummy-hash timing equalization; HMAC-SHA256 sessions with `timingSafeEqual` + length guard; dual per-IP+per-account login rate limiting (pre-increment-before-Argon2 TOCTOU fix); `proxy.ts` admin guard; all 30+ mutating actions store `requireSameOriginAdmin()` + `isAdmin()` (grep-confirmed); Drizzle parameterization + smart-collections allowlist compiler (depth cap, scalar enforcement, LIKE escaping, MAX_IN_VALUES); `admin-tokens` SHA-256 + constant-time; CSV `escapeCsvField` (C0/C1 + bidi/zero-width + formula prefix); 8 `dangerouslySetInnerHTML` via `safeJsonLd`; nonce CSP no `unsafe-inline`; both OG routes fail-closed SSRF; `serve-upload.ts` + db/download path-traversal (allowlist + SAFE_SEGMENT + realpath + lstat); `publicSelectFields` derive-by-omission + compile guards; Atom feed constant-NULL author; admin PATs 256-bit/hashed/scoped; CLIP production gating + heal; mysqldump argv arrays + `MYSQL_PWD`; `getClientIp` XFF only under `TRUST_PROXY`; deps clean (no new deps cycles 13-14).

**Bottom line:** No new exploitable vulnerability. One LOW latent defense-in-depth inconsistency (SEC-15-01) worth closing cheaply. All prior deferred items re-confirmed zero-caller/admin-only/latent.
