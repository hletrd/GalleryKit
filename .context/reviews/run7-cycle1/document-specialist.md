# Document Specialist Review — Run-7 Cycle-1

**HEAD:** 17f743f7
**Working tree:** CLEAN
**Reviewer:** document-specialist
**Scope:** Doc-vs-code mismatches against AUTHORITATIVE upstream sources (CLAUDE.md, README, inline comments vs. actual code + official specs). Verified 10 high-value claim surfaces.
**Date:** 2026-06-18

---

## SUMMARY

**2 findings (1 MEDIUM, 1 LOW).** Both are doc+code factual errors verified against authoritative upstream sources. No HIGH/CRIT. All other 8 verified claim surfaces are CORRECT.

The repo's prior document-specialist cycles (1-11) verified internal doc-vs-code consistency (counts, names, env vars, file paths) and found zero mismatches. This cycle's NEW angle — verifying doc claims against EXTERNAL authoritative upstream sources (ITU-T H.273, caniuse/MDN, OWASP, Stripe, Sharp, ICC, WCAG) — surfaced two factual errors that internal-only review could not catch, because the code and the doc agreed with each other but disagreed with the spec.

---

## FINDINGS

### R7C1-F1 [MEDIUM] — NCLX matrix code 8 mapped as "BT.2020-NCL" but H.273 defines code 8 = YCgCo

**Confidence:** HIGH (verified against two independent authoritative sources)

**Doc claim:**
- `CLAUDE.md:233` — "matrix `0=identity`, `1=BT.709`, **`8=BT.2020-NCL` (alias of 9)**, `9=BT.2020-NCL`, `10=BT.2020-CL` (AGG-D5)"

**Code claim:**
- `apps/web/src/lib/color-detection.ts:207` — `8: 'bt2020-ncl', // R5-M1: ITU-T H.273 Table 4 value 8 = BT.2020 NCL (same as 9)`

**Authoritative source (contradicts both):**
- **ITU-T H.273 Table 4 (MatrixCoefficients):** code 8 = **YCgCo** ("See equations 44 to 58"); code 9 = Rec. ITU-R BT.2020-2 (non-constant luminance); code 10 = Rec. ITU-R BT.2020-2 (constant luminance). Code 8 and code 9 are NOT aliases — they are entirely different matrix systems.
- **Colour science library** (canonical OSS H.273 implementation, `colour.models.rgb.itut_h_273`): `8: np.array("YCgCo")`, `9: np.array([0.2627, 0.0593])` (BT.2020 NCL). Confirmed at https://colour.readthedocs.io/en/v0.4.5/_modules/colour/models/rgb/itut_h_273.html
- **FFmpeg `AVColorSpace` enum** (mirrors H.273): `AVCOL_SPC_YCGCO = 8`, `AVCOL_SPC_BT2020_NCL = 9`. (Same source.)

**Impact:** LOW in practice — YCgCo is essentially never emitted in real-world photo NCLX boxes (it's a screen-content / codec-internal format), so the misclassification would not surface for real photos. But it is a factual spec error that would mislabel any file that DID carry code 8 (it would be stored and displayed to admins as `bt2020-ncl` instead of the correct `YCgCo` label), and it propagates a spec misreading into the repo's documentation.

**Suggested correction:**
- `color-detection.ts:207`: map `8: 'ycgco'` (add to the `ColorSignals['matrixCoefficients']` union), keep `9: 'bt2020-ncl'`, `10: 'bt2020-cl'`.
- `CLAUDE.md:233`: change "`8=BT.2020-NCL` (alias of 9)" to "`8=YCgCo`".
- Add a `matrix_coefficients` value test if not already covered.

---

### R7C1-F2 [LOW] — CLAUDE.md browser matrix overstates Firefox `(color-gamut: p3)` MQ behavior

**Confidence:** HIGH (verified against caniuse, MDN, Mozilla Bugzilla)

**Doc claim:**
- `CLAUDE.md` (Browser × OS × display matrix + Firefox photographer-visible impact): "Firefox 110+ supports the `(color-gamut: p3)` MQ, so `useDisplayCapability` reaches the MQ-branch — P3 badges and `WideGamutHint` behave like Chrome's MQ path on Firefox 110+."
- `apps/web/src/lib/use-display-capability.ts:64` comment: "R9-R1: Firefox 110+ supports (color-gamut: p3) MQ and reaches this branch."

**Authoritative sources (contradict the "behaves like Chrome" half):**
- **caniuse** (`mdn-css_at-rules_media_color-gamut`): shows Firefox 110-153 as "Supported" for the MQ *syntax*, BUT carries the verbatim note: "`color-gamut: p3` is always false because Firefox does not support wide-gamut color. See bug 1626624." (Verified at https://caniuse.com/mdn-css_at-rules_media_color-gamut on 2026-06-18.)
- **Mozilla Bugzilla 1626624** ("Support Wide Gamut Color in CSS with Display-P3"): OPEN. "On macOS we always use sRGB as the display profile." Firefox parses the MQ but always answers sRGB because it does not implement wide-gamut color rendering. (https://bugzilla.mozilla.org/show_bug.cgi?id=1626624)
- **MDN** (`@media/color-gamut`): lists Firefox 110+ as "Full support" for the media feature, with the same caniuse/Bugzilla caveat documented in the browser-compatibility notes.

**The nuance the doc misses:** the claim "Firefox 110+ supports the `(color-gamut: p3)` MQ" is technically TRUE at the syntax level (the MQ parses), but the operational claim that follows — "P3 badges and `WideGamutHint` behave like Chrome's MQ path on Firefox 110+" — is FALSE. On Firefox 110+ the MQ ALWAYS returns `matches: false` for `p3`, so `useDisplayCapability` falls through to the `'srgb'` default on Firefox 110+ exactly as it does on Firefox ≤109. P3 badges and the WideGamutHint are suppressed for ALL Firefox visitors regardless of version or actual display capability.

**Code impact:** The code at `use-display-capability.ts:61` (`window.matchMedia('(color-gamut: p3)').matches`) is BEHAVIORALLY correct — on Firefox it always returns false, so the conservative `'srgb'` fallback kicks in, which is the safe outcome. The defect is purely in the doc/comment's characterization of *why* and the claim that Firefox 110+ "behaves like Chrome". The functional result (Firefox always reports sRGB) is already what the code produces, so NO runtime change is needed — only a doc/comment correction.

**Suggested correction:**
- `CLAUDE.md` Firefox rows + "Firefox photographer-visible impact" section: replace "Firefox 110+ supports the `(color-gamut: p3)` MQ … behave like Chrome's MQ path" with: "Firefox 110+ parses the `(color-gamut: p3)` MQ syntax but always returns `false` because Firefox does not implement wide-gamut color rendering (Mozilla bug 1626624, open). `useDisplayCapability` therefore falls through to the conservative `'srgb'` default on ALL Firefox versions; P3 badges and the `WideGamutHint` are suppressed for all Firefox visitors regardless of display. The `force_show_color_chips` admin toggle overrides this for demos."
- `use-display-capability.ts:64` comment: align with the above.

---

## VERIFIED CORRECT (10 claim surfaces audited)

### 1. Tech stack versions — ALL CORRECT
- **CLAUDE.md:** "Next.js 16.2 (App Router, React 19, TypeScript 6)", "Drizzle ORM", "MySQL 8.0+", "Sharp".
- **`apps/web/package.json`:** `"next": "^16.2.3"` ✓, `"react": "^19.2.5"` / `"react-dom": "^19.2.5"` ✓, `"typescript": "^6"` ✓, `"drizzle-orm": "^0.45.2"` ✓, `"drizzle-kit": "1.0.0-beta.9-e89174b"` ✓, `"sharp": "^0.34.5"` ✓, `"stripe": "^22.1.0"` ✓, `"argon2": "^0.44.0"` ✓, `"@huggingface/transformers": "^3.8.1"` ✓, `"mysql2": "^3.22.0"` ✓.
- **README.md** badges (Next.js 16, React 19) ✓.
- Note: `engines.node: ">=24"` matches the global CLAUDE.md "Node.js 24 LTS" directive. ✓

### 2. Sharp `withMetadata()` keeps most input metadata incl. GPS — CORRECT (R4C8 COR-R4C8-01)
- **CLAUDE.md** privacy section: "Never use Sharp `withMetadata()` for stripping — `withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit".
- **Authoritative (Sharp docs via sharp.uihtm.com/api-metadata.html):** "`withMetadata()` 保留所有现有元数据" — calling `withMetadata()` with no args preserves EXIF (incl. GPS IFD), ICC, XMP, IPTC. Confirmed.
- **Code:** `apps/web/src/lib/gps-exif-strip.ts:5-10` documents the same finding ("Sharp 0.33+ KEEPS all input EXIF … GPS IFD therefore survived the 'strip' byte-for-byte") and implements byte-level surgery instead. ✓

### 3. onnxruntime-node bundles native .node for linux/arm64 + linux/x64 in tarball (no CUDA needed for CPU) — CORRECT
- **CLAUDE.md** ("Why the binary is already present…"): "onnxruntime-node bundles its native `.node` binding for all platforms — including `linux/arm64` and `linux/x64` — directly inside the npm package tarball … Its `postinstall` script only downloads CUDA `.so` files, which are not needed for CPU inference."
- **Authoritative (onnxruntime-node npm package + onnxruntime.ai):** pre-built binaries for Linux x64 + Linux arm64 (added v1.10.0) ship in the tarball; postinstall only fetches optional CUDA libraries. CPU inference works with no postinstall download. Confirmed. ✓

### 4. NCLX `colr` primaries + transfer H.273 code mappings — CORRECT (except matrix code 8, see R7C1-F1)
- **Primaries** (`color-detection.ts:170-175`): `1=bt709`, `9=bt2020`, `11=dci-p3`, `12=p3-d65`. Matches H.273 Table 2 (Colour lib: `1=PRIMARIES_BT709`, `9=PRIMARIES_BT2020`, `11=PRIMARIES_DCI_P3` SMPTE RP 431-2, `12=PRIMARIES_P3_D65` SMPTE EG 432-1). ✓
- **Transfer** (`color-detection.ts:177-201`): `1=srgb` (BT.709 OETF ≈ sRGB), `13=srgb` (IEC 61966-2-1), `14/15=gamma24` (BT.1886), `16=pq` (ST 2084), `17=gamma26` (ST 428-1), `18=hlg` (ARIB STD-B67). All match H.273 Table 3 (Colour lib confirms 16=`eotf_inverse_ST2084`, 17=`eotf_inverse_H273_ST428_1`, 18=`oetf_BT2100_HLG`). ✓
- **Matrix** (`color-detection.ts:204-210`): `0=identity`, `1=bt709`, `9=bt2020-ncl`, `10=bt2020-cl` — all correct per H.273 Table 4. ONLY `8` is wrong (see R7C1-F1).

### 5. ICC `mluc` v4 UTF-16BE locale-matched descriptor parsing — CORRECT
- **CLAUDE.md:** "ICC `desc` (v2) / `mluc` (v4 UTF-16BE, locale-matched) descriptor parser".
- **Authoritative (ICC.1:2022 spec):** the `multiLocalizedUnicodeType` (`mluc`, tag signature `0x6D6C7563`) is the v4+ Profile Description Tag type; Unicode text in records is UTF-16BE. Confirmed via ICC spec PDF.
- **Code:** `apps/web/src/lib/icc-extractor.ts:10` `new TextDecoder('utf-16be')`; lines 83-85 "Text is UTF-16BE per ICC, not UTF-16LE"; line 43 "language code is ISO 639-1". ✓

### 6. WCAG 2.2 touch-target claims (2.5.5 44px AAA, 2.5.8 24px AA) — CORRECT
- **CLAUDE.md** Touch-Target Audit: "44x44 px minimum … per WCAG 2.5.5 Target Size (Enhanced) — Level AAA in WCAG 2.2 (44×44 px; WCAG 2.2 also adds 2.5.8 Target Size (Minimum), Level AA, 24×24 px …)".
- **Authoritative (W3C WAI):** SC 2.5.5 Target Size (Enhanced) = 44×44 CSS px, AAA; SC 2.5.8 Target Size (Minimum) = 24×24 CSS px, AA (new in WCAG 2.2). Confirmed at https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html. ✓

### 7. Argon2id params (memoryCost=65536, timeCost=3, parallelism=4) vs OWASP minimums — CORRECT ("exceeds OWASP minimums")
- **CLAUDE.md:** "Argon2id, memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4 — exceeds OWASP minimums".
- **Code:** `apps/web/src/lib/password-hashing.ts:10-15` — exactly `memoryCost: 65_536, timeCost: 3, parallelism: 4, type: argon2.argon2id`. ✓
- **Authoritative (OWASP Password Storage Cheat Sheet):** minimum m=19 MiB (19456 KiB) / t=2 / p=1 (or m=46 MiB/t=1/p=1, or m=12 MiB/t=3/p=1). The repo's m=64 MiB (65536 KiB) / t=3 / p=4 strictly exceeds all four OWASP-minimum tradeoff rows. Claim "exceeds OWASP minimums" is TRUE. ✓ (Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

### 8. Stripe checkout `payment_method_types: ['card']` excludes async methods — CORRECT (AGG-H1)
- **CLAUDE.md:** "the checkout session is now pinned to `payment_method_types: ['card']` … so async-payment methods cannot be initiated and the money-taken-no-goods path is closed operationally."
- **Code:** `apps/web/src/app/api/checkout/[imageId]/route.ts:207` — `payment_method_types: ['card']`. ✓
- **Authoritative (Stripe docs):** `card` is a synchronous/immediate-capture method; async methods (SEPA debit, ACH `us_bank_account`, bank transfers, OXXO, Boleto, Bancontact, iDEAL, Sofort, etc.) fire `checkout.session.async_payment_succeeded` days later. Pinning to `['card']` excludes all of them — async methods cannot be initiated. Confirmed at https://docs.stripe.com/payments/payment-methods/integration-options. ✓

### 9. Drizzle migrator MAX(created_at) cursor + hash-based post-condition — CORRECT
- **CLAUDE.md** Migration & Schema-Drift Runbook: "It only checks `MAX(created_at)` — not per-entry hashes — across `__drizzle_migrations`." + the migrate.js post-condition that every journal hash MUST be present.
- **Authoritative (drizzle-orm migrator source):** migrator queries `SELECT ... FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`, takes `lastDbMigration = dbMigrations[0]`, then compares `lastDbMigration.created_at < migration.folderMillis` to decide apply. Confirmed via drizzle-orm GitHub issue #1009 + #5336 which quote the exact pattern.
- **Code:** `apps/web/scripts/migrate.js:620-621` — `SELECT hash FROM __drizzle_migrations` → Set, then hash-based post-condition assertion; `baselineAllJournalMigrations` inserts one row per journal entry keyed by hash (line 646). ✓

### 10. CSS multi-column masonry + tag_names GROUP_CONCAT — CORRECT (unchanged from cycle-11)
- Not in the 10-item verify list but spot-checked: `CLAUDE.md` Performance section says "pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass". Verified in the masonry component; no doc mismatch.

---

## NON-FINDINGS (intentional asymmetries, NOT defects)

- **i18n ko/en plural asymmetry (DOC-R5C3-07):** English uses ICU `{count, plural, …}`, Korean uses fixed `{count}장`. Korean has no grammatical plural; an ICU `plural` wrapper would be noise. Intentional, documented, correct.
- **SSR `SERVER_DEFAULT = { colorGamut: 'p3', isHdr: false }`:** defaults to P3 on the server to suppress the SDR-only `WideGamutHint` on first paint (avoids flicker for the common P3 case), then settles client-side after hydration. Intentional, documented in `use-display-capability.ts:22-26`. Correct.
- **`avif_10bit` public-safe (R10-M4):** describes encoded output, not source PII. Correctly in `publicSelectFields`.

---

## SOURCES (authoritative upstream verification)

- ITU-T H.273 (Colour lib canonical impl.): https://colour.readthedocs.io/en/v0.4.5/_modules/colour/models/rgb/itut_h_273.html
- ITU-T H.273 (official): https://www.itu.int/rec/T-REC-H.273
- caniuse color-gamut: https://caniuse.com/mdn-css_at-rules_media_color-gamut
- MDN color-gamut: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/color-gamut
- Mozilla Bugzilla 1626624 (Firefox wide-gamut): https://bugzilla.mozilla.org/show_bug.cgi?id=1626624
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- W3C WAI WCAG 2.2 SC 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Stripe payment-methods integration: https://docs.stripe.com/payments/payment-methods/integration-options
- Sharp metadata API (mirror of sharp.pixelplumbing.com): https://sharp.uihtm.com/api-metadata.html
- ICC.1:2022 spec: https://www.color.org/specification/ICC.1-2022-05.pdf
- drizzle-orm migrator (issue #1009 quotes source): https://github.com/drizzle-team/drizzle-orm/issues/1009
- onnxruntime-node (npm + onnxruntime.ai platform support)

---

## Summary table

| ID | Severity | Confidence | Surface | Status |
|---|---|---|---|---|
| R7C1-F1 | MEDIUM | HIGH | NCLX matrix code 8 = YCgCo, not BT.2020-NCL (H.273) | NEW — code + doc both wrong |
| R7C1-F2 | LOW | HIGH | Firefox 110+ `(color-gamut: p3)` always false (caniuse/MDN/Bugzilla) | NEW — doc overstates behavior; code already correct |

**8 of 10 audited claim surfaces verified CORRECT against authoritative upstream sources.** Both findings are doc/comment errors; R7C1-F1 also has a code-side mislabel (no real-world photo impact). No security, correctness, or data-loss finding. No HIGH or CRIT.
